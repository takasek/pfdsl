import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { chromium } from "playwright-core";
import { isCliEntrypoint } from "../../../scripts/lib/cli-entrypoint.mjs";
import {
	createRunDirectory,
	expectEventually,
	findWebviewFrame,
	makeLaunchArgs,
	populateVSCodeCache,
	prepareVSCodeCachePath,
	readTransform,
	removeRunDirectory,
} from "./harness.mjs";
import { waitForSourceCloseReady } from "./save-readiness.mjs";

const vscodeVersion = "1.132.1";
const cdpTimeoutMs = 30_000;
export const coldRenderTimeoutMs = 30_000;
const interactionTimeoutMs = 1_000;
const extensionHostLogFilePattern = /^exthost.*\.log$/i;
const maxExtensionHostLogFiles = 4;
const maxExtensionHostLogEntries = 200;
const maxExtensionHostLogTailBytes = 4_096;

export async function collectWorkbenchInteractionState(page) {
	return page.evaluate(() => {
		const describe = (element) =>
			element
				? {
						tag: element.tagName,
						id: element.id.slice(0, 100),
						class: String(element.className).slice(0, 160),
						role: element.getAttribute("role"),
					}
				: null;
		return {
			documentFocused: document.hasFocus(),
			activeElement: describe(document.activeElement),
			groups: document.querySelectorAll(".editor-group-container").length,
			tabs: [
				...document.querySelectorAll('.editor-group-container [role="tab"]'),
			]
				.slice(0, 8)
				.map((tab) => ({
					selected: tab.getAttribute("aria-selected"),
					label: tab.getAttribute("aria-label")?.slice(0, 160),
				})),
			quickInputs: [...document.querySelectorAll(".quick-input-widget input")]
				.slice(0, 4)
				.map((input) => ({
					...describe(input),
					visible:
						input.getClientRects().length > 0 &&
						getComputedStyle(input).visibility !== "hidden",
					disabled: input.disabled,
					readOnly: input.readOnly,
					inert: !!input.closest("[inert]"),
					focused: input === document.activeElement,
					mode: input.value.startsWith(">") ? "command" : "file",
				})),
		};
	});
}

export async function withWorkbenchOperation(
	page,
	label,
	operation,
	{
		readState = collectWorkbenchInteractionState,
		log = (event) => console.log("Workbench operation:", JSON.stringify(event)),
	} = {},
) {
	const snapshot = async () => {
		try {
			return await readState(page);
		} catch (error) {
			return { unavailable: error.message };
		}
	};
	log({ label, phase: "before", state: await snapshot() });
	try {
		const result = await operation();
		log({ label, phase: "after", state: await snapshot() });
		return result;
	} catch (error) {
		const state = await snapshot();
		log({ label, phase: "failed", state });
		throw new Error(
			`${label}: ${error.stack ?? error}\nWorkbench state: ${JSON.stringify(state)}`,
			{ cause: error },
		);
	}
}

export function quickInputValue(mode, text) {
	return mode === "command" ? `>${text}` : text;
}

let closeAttempt = 0;

export async function closeSourceTab(
	page,
	sourceTab,
	{
		readState = async () => ({
			sourceTabs: await sourceTab.count(),
			previewTabs: await page
				.getByRole("tab", { name: /^PFDSL Preview/ })
				.count(),
			groups: await page.locator(".editor-group-container").count(),
		}),
		log,
		timeoutMs = coldRenderTimeoutMs,
	} = {},
) {
	const directory = process.env.PFDSL_SMOKE_DIAGNOSTICS_DIR;
	const attempt = directory ? ++closeAttempt : 0;
	let sample = 0;
	let clickReturned = false;
	const snapshot = async () => {
		const phase =
			++sample === 1
				? "before"
				: clickReturned && sample === 2
					? "click-returned"
					: "result";
		try {
			const state = await sourceTab.evaluateAll((targets) => {
				const groups = [
					...document.querySelectorAll(".editor-group-container"),
				];
				const rect = (element) => {
					const { x, y, width, height } = element.getBoundingClientRect();
					return { x, y, width, height };
				};
				const describe = (element) => ({
					tag: element.tagName,
					label: element.getAttribute("aria-label")?.slice(0, 160),
					groupIndex: groups.indexOf(
						element.closest(".editor-group-container"),
					),
					rect: rect(element),
				});
				return {
					time: Date.now(),
					focused: document.hasFocus(),
					active: document.activeElement
						? describe(document.activeElement)
						: null,
					groups: groups
						.slice(0, 8)
						.map((group, index) => ({ index, rect: rect(group) })),
					tabs: [
						...document.querySelectorAll(
							'.editor-group-container [role="tab"]',
						),
					]
						.slice(0, 8)
						.map((tab) => ({
							...describe(tab),
							selected: tab.getAttribute("aria-selected"),
							dirty: tab.classList.contains("dirty"),
						})),
					targets: targets.slice(0, 2).map((tab) => ({
						...describe(tab),
						closeButtons: [
							...tab.querySelectorAll('[role="button"][aria-label^="Close ("]'),
						]
							.slice(0, 2)
							.map(describe),
					})),
					dialogs: [
						...document.querySelectorAll('[role="dialog"], .monaco-dialog-box'),
					]
						.filter(
							(element) =>
								element.getClientRects().length > 0 &&
								!["hidden", "collapse"].includes(
									getComputedStyle(element).visibility,
								),
						)
						.slice(0, 4)
						.map(describe),
				};
			});
			const path = join(directory, `close-${attempt}-${phase}`);
			await mkdir(directory, { recursive: true });
			await writeFile(
				`${path}.json`,
				JSON.stringify({ phase, clickReturned, state }, null, 2),
			);
			await page.screenshot({
				path: `${path}.png`,
				timeout: interactionTimeoutMs,
			});
			return state;
		} catch (error) {
			console.warn(`Source-close snapshot ${phase}: ${error.message}`);
			return { unavailable: error.message };
		}
	};
	return withWorkbenchOperation(
		page,
		"close source tab",
		async () => {
			await sourceTab.getByRole("button", { name: /^Close \(/ }).click();
			if (directory) {
				clickReturned = true;
				await snapshot();
			}
			return expectEventually(
				"source hidden and preview retained",
				readState,
				(state) =>
					state.sourceTabs === 0 &&
					state.previewTabs === 1 &&
					state.groups === 1,
				{ timeoutMs },
			);
		},
		{
			...(log ? { log } : {}),
			...(log ? { readState } : {}),
			...(directory ? { readState: snapshot } : {}),
		},
	);
}

async function submitQuickInput(page, focusTarget, shortcut, mode, text) {
	return withWorkbenchOperation(
		page,
		`${mode} picker: ${mode === "command" ? text : "open fixture"}`,
		async () => {
			// Focus the workbench tab without clicking it and scheduling editor/webview focus.
			await focusTarget.focus();
			await focusTarget.press(shortcut);
			const input = page.locator(
				".quick-input-widget:not([inert]) input:visible",
			);
			await waitForInteraction(
				`${mode} picker ready`,
				async () => {
					if ((await input.count()) !== 1) return false;
					return input.evaluate(
						(element, expectedMode) =>
							document.hasFocus() &&
							document.activeElement === element &&
							!element.disabled &&
							!element.readOnly &&
							!element.closest("[inert]") &&
							(element.value.startsWith(">") ? "command" : "file") ===
								expectedMode,
						mode,
					);
				},
				(ready) => ready,
				{ timeoutMs: coldRenderTimeoutMs },
			);
			const value = quickInputValue(mode, text);
			await input.fill(value);
			assert.equal(await input.inputValue(), value);
			if (mode === "command") {
				await page
					.locator(".quick-input-widget .label-name")
					.getByText(text, { exact: true })
					.waitFor({ state: "visible" });
			}
			await input.press("Enter");
			await page.locator(".quick-input-widget").waitFor({ state: "hidden" });
		},
	);
}

export function resolveVSCodeExecutablePath(
	vscodeExecutablePath,
	{ exists = existsSync, platform = process.platform } = {},
) {
	if (exists(vscodeExecutablePath)) return vscodeExecutablePath;
	if (platform === "darwin" && basename(vscodeExecutablePath) === "Electron") {
		const codePath = join(dirname(vscodeExecutablePath), "Code");
		if (exists(codePath)) return codePath;
	}
	throw new Error(`VS Code executable not found: ${vscodeExecutablePath}`);
}

function collectOutput(stream) {
	let output = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk) => {
		output += chunk;
	});
	return () => output;
}

function formatDiagnostic(
	message,
	{ page, processError, vscodeProcess, output },
) {
	const frameUrls = page
		? page
				.frames()
				.map((frame) => frame.url())
				.join(", ")
		: "unavailable";
	const exit = vscodeProcess
		? `code=${vscodeProcess.exitCode}, signal=${vscodeProcess.signalCode}`
		: "not started";
	return [
		message,
		`VS Code version: ${vscodeVersion}`,
		`frame URLs: ${frameUrls}`,
		`VS Code process: ${exit}`,
		`process error: ${processError?.message ?? "none"}`,
		`stdout:\n${output?.stdout() ?? ""}`,
		`stderr:\n${output?.stderr() ?? ""}`,
	].join("\n");
}

export function appendCleanupDiagnostics(primaryError, cleanupErrors) {
	if (cleanupErrors.length === 0) return primaryError;
	const cleanupSummary = cleanupErrors.map((error) => error.message).join("\n");
	return new Error(
		`${primaryError.message}\nCleanup failures:\n${cleanupSummary}`,
		{
			cause: new AggregateError(
				[primaryError, ...cleanupErrors],
				"Smoke test failed and cleanup failed",
			),
		},
	);
}

async function findExtensionHostLogPaths(profileDir) {
	const directories = [join(profileDir, "logs")];
	const paths = [];
	let entriesRead = 0;
	while (directories.length > 0 && paths.length < maxExtensionHostLogFiles) {
		const directory = directories.pop();
		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			if (error?.code === "ENOENT") continue;
			throw error;
		}
		for (const entry of entries) {
			entriesRead += 1;
			if (entriesRead > maxExtensionHostLogEntries) return paths;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				directories.push(path);
			} else if (
				entry.isFile() &&
				extensionHostLogFilePattern.test(entry.name)
			) {
				paths.push(path);
				if (paths.length === maxExtensionHostLogFiles) return paths;
			}
		}
	}
	return paths;
}

function tailLog(text) {
	return text.length > maxExtensionHostLogTailBytes
		? text.slice(-maxExtensionHostLogTailBytes)
		: text;
}

export async function appendExtensionHostLogDiagnostics(
	primaryError,
	profileDir,
) {
	try {
		const paths = await findExtensionHostLogPaths(profileDir);
		const logs = await Promise.all(
			paths.map(
				async (path) => `${path}:\n${tailLog(await readFile(path, "utf8"))}`,
			),
		);
		return new Error(
			`${primaryError.message}\nExtension host logs:\n${logs.join("\n") || "none found"}`,
			{ cause: primaryError },
		);
	} catch (error) {
		return new Error(
			`${primaryError.message}\nExtension host logs: unavailable (${error.message})`,
			{ cause: primaryError },
		);
	}
}

function delay(milliseconds) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function waitForWorkbenchPage(
	browser,
	{ delay: wait = delay, timeoutMs = cdpTimeoutMs } = {},
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				if (page.url().includes("/workbench/workbench.html")) return page;
			}
		}
		await wait(100);
	}
	throw new Error("Timed out waiting for the VS Code workbench page");
}

async function reservePort() {
	const server = createServer();
	await new Promise((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	if (typeof address !== "object" || address === null) {
		throw new Error("Unable to reserve a CDP port");
	}
	await new Promise((resolveClose, rejectClose) => {
		server.close((error) => (error ? rejectClose(error) : resolveClose()));
	});
	return address.port;
}

async function connectToVSCode({
	endpoint,
	output,
	processError,
	vscodeProcess,
}) {
	const deadline = Date.now() + cdpTimeoutMs;
	let lastError;
	while (Date.now() < deadline) {
		if (
			processError ||
			vscodeProcess.exitCode !== null ||
			vscodeProcess.signalCode !== null
		) {
			throw new Error(
				formatDiagnostic(
					"VS Code exited before the CDP endpoint became available",
					{
						processError,
						vscodeProcess,
						output,
					},
				),
			);
		}
		try {
			return await chromium.connectOverCDP(endpoint);
		} catch (error) {
			lastError = error;
			await delay(100);
		}
	}
	throw new Error(
		formatDiagnostic(
			`Timed out connecting to ${endpoint}: ${lastError?.message ?? "unknown error"}`,
			{
				processError,
				vscodeProcess,
				output,
			},
		),
	);
}

async function stopVSCode(vscodeProcess) {
	if (
		!vscodeProcess ||
		vscodeProcess.exitCode !== null ||
		vscodeProcess.signalCode !== null
	)
		return;
	const exited = new Promise((resolveExit) =>
		vscodeProcess.once("close", resolveExit),
	);
	vscodeProcess.kill("SIGTERM");
	let timeout;
	try {
		const didExit = await Promise.race([
			exited.then(() => true),
			new Promise((resolveTimeout) => {
				timeout = setTimeout(() => resolveTimeout(false), 5_000);
			}),
		]);
		if (!didExit) {
			vscodeProcess.kill("SIGKILL");
			await exited;
		}
	} finally {
		clearTimeout(timeout);
	}
}

export async function cleanupSmokeSession({ browser, runDir, vscodeProcess }) {
	const cleanupErrors = [];
	try {
		await browser?.close();
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await stopVSCode(vscodeProcess);
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await removeRunDirectory(runDir);
	} catch (error) {
		cleanupErrors.push(error);
	}
	return cleanupErrors;
}

export async function assertVisibleCount(locator, expected, label) {
	const count = await locator.count();
	const visibility = await Promise.all(
		Array.from({ length: count }, (_, index) => locator.nth(index).isVisible()),
	);
	const visibleCount = visibility.filter(Boolean).length;
	assert.equal(
		visibleCount,
		expected,
		`${label}: expected ${expected} visible ${expected === 1 ? "element" : "elements"}, observed ${visibleCount}`,
	);
	return visibleCount;
}

export async function waitForVisibleCount(locator, expected, label, options) {
	return expectEventually(
		label,
		async () => {
			const count = await locator.count();
			const visibility = await Promise.all(
				Array.from({ length: count }, (_, index) =>
					locator.nth(index).isVisible(),
				),
			);
			return visibility.filter(Boolean).length;
		},
		(visibleCount) => visibleCount === expected,
		options,
	);
}

export async function waitForColdRender(
	locator,
	expected,
	label,
	{ waitForVisible = waitForVisibleCount, ...options } = {},
) {
	return waitForVisible(locator, expected, label, {
		...options,
		timeoutMs: coldRenderTimeoutMs,
	});
}

function waitForInteraction(label, read, predicate, options) {
	return expectEventually(label, read, predicate, {
		timeoutMs: interactionTimeoutMs,
		...options,
	});
}

const geometryTolerance = 1;
const scaleTolerance = 0.000_001;

function isWithinGeometryTolerance(actual, expected) {
	return Math.abs(actual - expected) <= geometryTolerance;
}

export function isWithinScaleTolerance(actual, expected) {
	return Math.abs(actual - expected) <= scaleTolerance;
}

function transformsMatch(actual, expected) {
	return (
		isWithinGeometryTolerance(actual.panX, expected.panX) &&
		isWithinGeometryTolerance(actual.panY, expected.panY) &&
		isWithinScaleTolerance(actual.scale, expected.scale)
	);
}

export function findTextEndPosition(text, needle) {
	if (needle.length === 0)
		throw new Error("Expected a non-empty fixture node ID");
	const start = text.indexOf(needle);
	if (start === -1)
		throw new Error(`Fixture does not contain node ID: ${needle}`);
	const prefix = text.slice(0, start + needle.length);
	const lines = prefix.split("\n");
	return { line: lines.length, column: lines.at(-1).length + 1 };
}

export function parseStatusCursorPosition(statusText) {
	const match = /Ln (\d+), Col (\d+)(?: \(\d+ selected\))?\b/.exec(statusText);
	if (!match) return null;
	return { line: Number(match[1]), column: Number(match[2]) };
}

function cursorPositionsMatch(actual, expected) {
	return (
		actual !== null &&
		actual.line === expected.line &&
		actual.column === expected.column
	);
}

export function isCursorNavigationTransition(before, after, expected) {
	return (
		!cursorPositionsMatch(before, expected) &&
		cursorPositionsMatch(after, expected)
	);
}

async function readStatusText(page) {
	const status = page.getByRole("status");
	const count = await status.count();
	if (count !== 1) {
		throw new Error(
			`VS Code status bar: expected 1 element, observed ${count}`,
		);
	}
	return status.textContent();
}

async function readStatusCursorPosition(page) {
	return parseStatusCursorPosition(await readStatusText(page));
}

export async function waitForStatusCursorPosition(page, label, options) {
	return waitForInteraction(
		label,
		() => readStatusCursorPosition(page),
		(position) => position !== null,
		options,
	);
}

async function readBoundingBox(locator, label) {
	const box = await locator.boundingBox();
	if (!box) throw new Error(`${label}: expected a visible bounding box`);
	return box;
}

async function readRect(frame, selector) {
	return frame.locator(selector).evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			borderLeft: Number.parseFloat(style.borderLeftWidth),
			borderRight: Number.parseFloat(style.borderRightWidth),
			borderTop: Number.parseFloat(style.borderTopWidth),
			borderBottom: Number.parseFloat(style.borderBottomWidth),
		};
	});
}

async function readMinimapGeometry(frame) {
	const [root, svg, minimap, viewport] = await Promise.all([
		readRect(frame, "#root"),
		readRect(frame, "#inner svg"),
		readRect(frame, "#minimap"),
		readRect(frame, "#minimap-vp"),
	]);
	return { root, svg, minimap, viewport };
}

function expectedMinimapViewport(geometry, transform) {
	const naturalSvgWidth = geometry.svg.width / transform.scale;
	const naturalSvgHeight = geometry.svg.height / transform.scale;
	const minimapContentWidth =
		geometry.minimap.width -
		geometry.minimap.borderLeft -
		geometry.minimap.borderRight;
	const minimapContentHeight =
		geometry.minimap.height -
		geometry.minimap.borderTop -
		geometry.minimap.borderBottom;
	const minimapScale = Math.min(
		minimapContentWidth / naturalSvgWidth,
		minimapContentHeight / naturalSvgHeight,
	);
	return {
		left:
			geometry.minimap.left +
			geometry.minimap.borderLeft +
			(-transform.panX / transform.scale) * minimapScale,
		top:
			geometry.minimap.top +
			geometry.minimap.borderTop +
			(-transform.panY / transform.scale) * minimapScale,
		width:
			(geometry.root.width / transform.scale) * minimapScale +
			geometry.viewport.borderLeft +
			geometry.viewport.borderRight,
		height:
			(geometry.root.height / transform.scale) * minimapScale +
			geometry.viewport.borderTop +
			geometry.viewport.borderBottom,
	};
}

function minimapViewportMatches(geometry, transform) {
	const expected = expectedMinimapViewport(geometry, transform);
	return (
		isWithinGeometryTolerance(geometry.viewport.left, expected.left) &&
		isWithinGeometryTolerance(geometry.viewport.top, expected.top) &&
		isWithinGeometryTolerance(geometry.viewport.width, expected.width) &&
		isWithinGeometryTolerance(geometry.viewport.height, expected.height)
	);
}

export function minimapDragChangesPan(afterMouseDown, afterMouseMove) {
	return (
		!isWithinGeometryTolerance(afterMouseMove.panX, afterMouseDown.panX) &&
		!isWithinGeometryTolerance(afterMouseMove.panY, afterMouseDown.panY) &&
		isWithinScaleTolerance(afterMouseMove.scale, afterMouseDown.scale)
	);
}

export function minimapClickChangesPan(beforeClick, afterClick) {
	return (
		(!isWithinGeometryTolerance(afterClick.panX, beforeClick.panX) ||
			!isWithinGeometryTolerance(afterClick.panY, beforeClick.panY)) &&
		isWithinScaleTolerance(afterClick.scale, beforeClick.scale)
	);
}

export async function collectWebviewFailureSnapshot(frame) {
	const snapshot = await frame.locator("#root").evaluate((root) => {
		const rect = (element) => {
			if (!element) return null;
			const value = element.getBoundingClientRect();
			return {
				left: value.left,
				top: value.top,
				width: value.width,
				height: value.height,
			};
		};
		const inner = root.querySelector("#inner");
		return {
			root: rect(root),
			svg: rect(root.querySelector("#inner svg")),
			minimap: rect(root.querySelector("#minimap")),
			minimapViewport: rect(root.querySelector("#minimap-vp")),
			err: (() => {
				const error =
					root.parentElement?.querySelector(".err") ??
					root.querySelector(".err");
				return {
					visible: error ? error.getClientRects().length > 0 : false,
					text: error?.textContent ?? null,
				};
			})(),
			transform: inner?.style.transform ?? null,
			nodeIds: Array.from(
				root.querySelectorAll("#inner g.node[data-node-id]"),
				(node) => node.getAttribute("data-node-id"),
			).filter(Boolean),
			scriptSrcs: Array.from(
				root.ownerDocument.querySelectorAll("script[src]"),
				(script) => script.src,
			),
		};
	});
	return { frameUrl: frame.url(), ...snapshot };
}

export async function appendWebviewFailureSnapshot(primaryError, frame) {
	try {
		const snapshot = await collectWebviewFailureSnapshot(frame);
		return new Error(
			`${primaryError.message}\nWebview snapshot:\n${JSON.stringify(snapshot)}`,
			{ cause: primaryError },
		);
	} catch (snapshotError) {
		return new Error(
			`${primaryError.message}\nWebview snapshot: unavailable (${snapshotError.message})`,
			{ cause: primaryError },
		);
	}
}

async function findEmptyRootPoint(frame, rootBox) {
	const nodes = frame.locator("#inner g.node[data-node-id]");
	const boxes = await Promise.all(
		Array.from({ length: await nodes.count() }, (_, index) =>
			readBoundingBox(nodes.nth(index), `sample node ${index + 1}`),
		),
	);
	const candidates = [
		{ x: rootBox.x + 20, y: rootBox.y + 20 },
		{ x: rootBox.x + rootBox.width - 20, y: rootBox.y + 20 },
		{ x: rootBox.x + 20, y: rootBox.y + rootBox.height - 20 },
	];
	const point = candidates.find(
		(candidate) =>
			!boxes.some(
				(box) =>
					candidate.x >= box.x &&
					candidate.x <= box.x + box.width &&
					candidate.y >= box.y &&
					candidate.y <= box.y + box.height,
			),
	);
	if (!point)
		throw new Error("preview root: unable to find an empty drag point");
	return point;
}

async function assertPreviewInteractions(session) {
	const { frame, page } = session;
	const root = frame.locator("#root");
	const firstNode = frame.locator("#inner g.node[data-node-id]").first();
	const beforeZoom = await readTransform(frame);
	const nodeBeforeZoom = await readBoundingBox(firstNode, "first sample node");
	const cursor = {
		x: nodeBeforeZoom.x + nodeBeforeZoom.width / 2,
		y: nodeBeforeZoom.y + nodeBeforeZoom.height / 2,
	};
	await page.mouse.move(cursor.x, cursor.y);
	await page.mouse.wheel(0, -120);
	const afterZoom = await waitForInteraction(
		"zoom increases preview scale",
		() => readTransform(frame),
		(transform) => transform.scale > beforeZoom.scale,
	);
	await waitForInteraction(
		"zoom keeps the cursor anchor stable",
		async () => {
			const node = await readBoundingBox(firstNode, "zoomed first sample node");
			return {
				cursor,
				nodeCenter: {
					x: node.x + node.width / 2,
					y: node.y + node.height / 2,
				},
			};
		},
		({ nodeCenter }) =>
			isWithinGeometryTolerance(nodeCenter.x, cursor.x) &&
			isWithinGeometryTolerance(nodeCenter.y, cursor.y),
	);

	const rootBox = await readBoundingBox(root, "preview root");
	const panStart = await findEmptyRootPoint(frame, rootBox);
	const beforePan = await readTransform(frame);
	await page.mouse.move(panStart.x, panStart.y);
	await page.mouse.down();
	await page.mouse.move(panStart.x + 40, panStart.y + 25);
	await page.mouse.up();
	await waitForInteraction(
		"graph pan follows the drag distance",
		() => readTransform(frame),
		(transform) =>
			isWithinGeometryTolerance(transform.panX, beforePan.panX + 40) &&
			isWithinGeometryTolerance(transform.panY, beforePan.panY + 25),
	);

	const releaseStart = await findEmptyRootPoint(frame, rootBox);
	const beforeOutsideRelease = await readTransform(frame);
	await page.mouse.move(releaseStart.x, releaseStart.y);
	await page.mouse.down();
	await page.mouse.move(releaseStart.x + 10, releaseStart.y + 8);
	await waitForInteraction(
		"outside release starts a second graph drag",
		() => readTransform(frame),
		(transform) =>
			!transformsMatch(transform, beforeOutsideRelease) &&
			isWithinScaleTolerance(transform.scale, beforeOutsideRelease.scale),
	);
	await page.mouse.move(rootBox.x - 20, rootBox.y - 20);
	await page.mouse.up();
	const afterOutsideRelease = await readTransform(frame);
	await page.mouse.move(releaseStart.x + 20, releaseStart.y + 20);
	await waitForInteraction(
		"outside release prevents further graph pan",
		() => readTransform(frame),
		(transform) => transformsMatch(transform, afterOutsideRelease),
	);

	await expectEventually(
		"minimap viewport matches preview geometry",
		async () => ({
			geometry: await readMinimapGeometry(frame),
			transform: await readTransform(frame),
		}),
		({ geometry, transform }) => minimapViewportMatches(geometry, transform),
	);
	const minimap = frame.locator("#minimap");
	const minimapBox = await readBoundingBox(minimap, "minimap");
	const beforeMinimapClick = await readTransform(frame);
	await page.mouse.move(
		minimapBox.x + minimapBox.width * 0.25,
		minimapBox.y + minimapBox.height * 0.75,
	);
	await page.mouse.down();
	await page.mouse.up();
	const afterMinimapClick = await waitForInteraction(
		"minimap click changes preview pan without changing scale",
		() => readTransform(frame),
		(transform) => minimapClickChangesPan(beforeMinimapClick, transform),
	);
	await page.mouse.move(
		minimapBox.x + minimapBox.width * 0.25,
		minimapBox.y + minimapBox.height * 0.75,
	);
	await page.mouse.down();
	const afterMinimapMouseDown = await readTransform(frame);
	await page.mouse.move(
		minimapBox.x + minimapBox.width * 0.75,
		minimapBox.y + minimapBox.height * 0.25,
	);
	assert.ok(
		minimapClickChangesPan(beforeMinimapClick, afterMinimapClick),
		"minimap click must pan without changing preview scale",
	);
	await page.mouse.up();
	await waitForInteraction(
		"minimap drag changes preview pan after pointer movement",
		() => readTransform(frame),
		(transform) => minimapDragChangesPan(afterMinimapMouseDown, transform),
	);

	const fixtureText = await readFile(session.fixturePath, "utf8");
	const designOccurrence = fixtureText.match(/\bdesign\b/)?.[0];
	assert.ok(designOccurrence, "smoke fixture must name the design node");
	const expectedCursorPosition = findTextEndPosition(
		fixtureText,
		designOccurrence,
	);
	const sourceTab = page.getByRole("tab", {
		name: /^01-simple-chain\.pfdsl(?:, Editor Group \d+)?$/,
	});
	await sourceTab.click();
	const cursorBeforeNavigation = await waitForStatusCursorPosition(
		page,
		"source editor reports its cursor position",
	);
	assert.notDeepEqual(
		cursorBeforeNavigation,
		expectedCursorPosition,
		"node navigation must start away from the fixture selection endpoint",
	);
	await frame.locator('#inner g.node[data-node-id="design"]').dblclick();
	await waitForInteraction(
		"node double-click moves the source cursor to design",
		() => readStatusCursorPosition(page),
		(cursorAfterNavigation) =>
			isCursorNavigationTransition(
				cursorBeforeNavigation,
				cursorAfterNavigation,
				expectedCursorPosition,
			),
	);

	assert.ok(afterZoom.scale > beforeZoom.scale, "zoom scale must increase");
}

async function assertGraphFits(frame) {
	await expectEventually(
		"Fit keeps all four SVG edges inside the viewport",
		async () => ({
			root: await readBoundingBox(frame.locator("#root"), "root"),
			svg: await readBoundingBox(frame.locator("#inner svg"), "SVG"),
		}),
		({ root, svg }) =>
			svg.x >= root.x - 1 &&
			svg.y >= root.y - 1 &&
			svg.x + svg.width <= root.x + root.width + 1 &&
			svg.y + svg.height <= root.y + root.height + 1,
	);
}

async function editFixture(session, text) {
	await session.page
		.getByRole("tab", {
			name: /^01-simple-chain\.pfdsl(?:, Editor Group \d+)?$/,
		})
		.click();
	await session.page.keyboard.press(
		process.platform === "darwin" ? "Meta+a" : "Control+a",
	);
	await session.page.keyboard.insertText(text);
}

async function assertPreviewUsability(session) {
	const { frame } = session;
	await frame.locator("#fit-graph").click();
	await assertGraphFits(frame);
	await frame.locator("#actual-size").click();
	assert.equal(
		(await readTransform(frame)).scale,
		1,
		"100% restores native scale",
	);
	await frame.locator("#zoom-in").click();
	assert.equal(
		(await frame.locator("#zoom-level").textContent()).trim(),
		"110%",
	);
	await frame.locator("#preview-help-toggle").click();
	assert.match(
		await frame.locator("#preview-help").textContent(),
		/Wheel:.*Drag:.*Minimap:/,
	);
	await frame.locator("#preview-help-toggle").click();
	const view = await readTransform(frame);
	await editFixture(session, "requirements >> design ->");
	await waitForColdRender(frame.locator("#preview-error"), 1, "syntax error");
	const errorGeometry = await frame
		.locator("#preview-error")
		.evaluate((error) => ({
			text: error.textContent,
			fontSize: getComputedStyle(error).fontSize,
			transform: getComputedStyle(error).transform,
			whiteSpace: getComputedStyle(error).whiteSpace,
			overflowWrap: getComputedStyle(error).overflowWrap,
			outsideGraph: !error.closest("#inner"),
		}));
	assert.match(
		errorGeometry.text,
		/P007: Expected artifact expression after ->/,
	);
	assert.equal(errorGeometry.fontSize, "13px");
	assert.equal(errorGeometry.transform, "none");
	assert.equal(errorGeometry.whiteSpace, "pre-wrap");
	assert.equal(errorGeometry.overflowWrap, "anywhere");
	assert.equal(errorGeometry.outsideGraph, true);
	assert.equal(await frame.locator("#minimap").isVisible(), false);
	assert.equal(await frame.locator("#minimap-svg svg").count(), 0);
	assert.equal(await frame.locator("#zoom-in").isDisabled(), true);
	await editFixture(session, "requirements >> design -> recovered\n");
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="recovered"]'),
		1,
		"recovered diagram",
	);
	await waitForColdRender(
		frame.locator('#minimap-svg g.node[data-node-id="recovered"]'),
		1,
		"recovered minimap",
	);
	assert.ok(
		transformsMatch(await readTransform(frame), view),
		"error recovery preserves the view",
	);
	await editFixture(session, "requirements >> design -> edited\n");
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="edited"]'),
		1,
		"live edit",
	);
	assert.ok(
		transformsMatch(await readTransform(frame), view),
		"ordinary edits preserve the view",
	);
	// A wide fixture exercises real SVG/CSS geometry.
	const wide = Array.from(
		{ length: 24 },
		(_, i) => `a${i} >> p${i} -> a${i + 1}`,
	).join("\n");
	await editFixture(session, wide);
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="a24"]'),
		1,
		"wide diagram",
	);
	await frame.locator("#fit-graph").click();
	await assertGraphFits(frame);
	await editFixture(session, await readFile(session.fixturePath, "utf8"));
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="spec"]'),
		1,
		"restored fixture",
	);
	await frame.locator("#fit-graph").click();
	console.log(
		"preview usability: Fit/100%/zoom/help, error recovery and live-edit view preservation passed",
	);
}

async function assertDefinitionQuickFix(session) {
	const modifier = process.platform === "darwin" ? "Meta" : "Control";
	await editFixture(session, "requirements >> design -> smoke_output");
	await waitForColdRender(
		session.frame.locator('#inner g.node[data-node-id="smoke_output"]'),
		1,
		"Quick Fix input",
	);
	await session.page.keyboard.press("ArrowLeft");
	await session.page.keyboard.press(`${modifier}+.`);
	await session.page
		.getByText('Insert artifact definition for "smoke_output"', { exact: true })
		.waitFor({ state: "visible" });
	await session.page.keyboard.press("Enter");
	await waitForInteraction(
		"Quick Fix moved to the new label selection",
		() => readStatusText(session.page),
		(text) => /Ln 4, Col 24 \(12 selected\)/.test(text),
	);
	await session.page.keyboard.insertText("FriendlyResult");
	await expectEventually(
		"Quick Fix selected the inserted label value",
		() =>
			session.frame
				.locator('#inner g.node[data-node-id="smoke_output"] text')
				.allTextContents(),
		(texts) => texts.some((text) => text.trim() === "FriendlyResult"),
	);
	await session.page.keyboard.press(`${modifier}+z`);
	await expectEventually(
		"Undo restores the selected label",
		() =>
			session.frame
				.locator('#inner g.node[data-node-id="smoke_output"]')
				.textContent(),
		(text) => text && !text.includes("FriendlyResult"),
	);
	await session.page.keyboard.press(`${modifier}+z`);
	const source = session.page.locator(".monaco-editor .view-lines").first();
	await expectEventually(
		"one Undo removes the definition insertion",
		() => source.textContent(),
		(text) => text && !text.includes("artifact:") && !text.includes("label:"),
	);
	await editFixture(session, await readFile(session.fixturePath, "utf8"));
	await waitForColdRender(
		session.frame.locator('#inner g.node[data-node-id="spec"]'),
		1,
		"fixture after Quick Fix Undo",
	);
	console.log(
		"definition Quick Fix: label selection and single-edit Undo passed",
	);
}

async function assertPreviewEditingFocus(session) {
	const { frame, page } = session;
	const sourceTab = page.getByRole("tab", {
		name: /^01-simple-chain\.pfdsl(?:, Editor Group \d+)?$/,
	});
	const previewTab = page.getByRole("tab", { name: /^PFDSL Preview/ });
	await editFixture(session, "a >> p -> b\n");
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="p"]'),
		1,
		"editing fixture",
	);
	await frame.locator("#fit-graph").click();
	await frame
		.locator('#inner g.node[data-node-id="p"]')
		.click({ button: "right" });
	for (const target of ["first_result", "second_result"]) {
		await frame.locator("#connector-kind").selectOption("->");
		await frame.locator("#connector-target").fill(target);
		await frame
			.getByRole("button", { name: "Add connection", exact: true })
			.click();
		await waitForColdRender(
			frame.locator(`#inner g.node[data-node-id="${target}"]`),
			1,
			`connection ${target}`,
		);
		assert.equal(
			await previewTab.getAttribute("aria-selected"),
			"true",
			"connection leaves the preview tab selected",
		);
		assert.equal(
			await frame
				.locator("#node-actions-toggle")
				.evaluate(
					(button) => document.activeElement === button && document.hasFocus(),
				),
			true,
			"connection keeps keyboard focus in the preview",
		);
		assert.equal(
			await sourceTab.getAttribute("aria-selected"),
			"true",
			"source remains simultaneously visible in its own group",
		);
		await frame.locator("#node-actions-toggle").click();
	}
	await frame.locator("#node-actions-close").click();
	await frame
		.locator('#inner g.node[data-node-id="b"]')
		.click({ button: "right" });
	await frame
		.getByRole("button", { name: "Create definition", exact: true })
		.click();
	await waitForInteraction(
		"definition focuses its source label without covering the preview",
		() => page.locator(".monaco-editor.focused").count(),
		(count) => count > 0,
	);
	assert.equal(await previewTab.getAttribute("aria-selected"), "true");
	await page.keyboard.insertText("Smoke output");
	await waitForInteraction(
		"definition label accepts typing in the source editor",
		() => frame.locator('#inner g.node[data-node-id="b"]').textContent(),
		(text) => text.includes("Smoke output"),
	);
	const modifier = process.platform === "darwin" ? "Meta" : "Control";
	await page.keyboard.press(`${modifier}+s`);
	await waitForInteraction(
		"definition changes are saved before closing the source",
		() => readFile(session.fixturePath, "utf8"),
		(text) => text.includes("Smoke output"),
		{ timeoutMs: coldRenderTimeoutMs },
	);
	await waitForSourceCloseReady(sourceTab, { timeoutMs: coldRenderTimeoutMs });
	await closeSourceTab(page, sourceTab);
	await frame.locator('#inner g.node[data-node-id="p"]').press("Enter");
	await frame.locator("#connector-kind").selectOption("->");
	await frame.locator("#connector-target").fill("reopened_result");
	await frame
		.getByRole("button", { name: "Add connection", exact: true })
		.click();
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="reopened_result"]'),
		1,
		"reopened source connection",
	);
	await waitForInteraction(
		"a removed source group reopens beside the focused preview",
		async () => ({
			groups: await page.locator(".editor-group-container").count(),
			sourceSelected: await sourceTab.getAttribute("aria-selected"),
			previewSelected: await previewTab.getAttribute("aria-selected"),
			previewFocused: await frame
				.locator("#node-actions-toggle")
				.evaluate(
					(button) => document.activeElement === button && document.hasFocus(),
				),
		}),
		(state) =>
			state.groups === 2 &&
			state.sourceSelected === "true" &&
			state.previewSelected === "true" &&
			state.previewFocused,
	);
	console.log(
		"preview editing: repeated connections preserve preview focus; definition editing preserves columns; removed source group reopens beside preview",
	);
}

async function assertHiddenSourceExternalChange(session) {
	const { frame, page } = session;
	const source = "closed_input >> hidden_source_process -> closed_output\n";
	const sourceTab = page
		.getByRole("tab", {
			name: /^01-simple-chain\.pfdsl(?:, Editor Group \d+)?$/,
		})
		.last();
	const modifier = process.platform === "darwin" ? "Meta" : "Control";
	await editFixture(session, source);
	await page.keyboard.press(`${modifier}+s`);
	await waitForInteraction(
		"fixture saved",
		() => readFile(session.fixturePath, "utf8"),
		(text) => text === source,
		{ timeoutMs: coldRenderTimeoutMs },
	);
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="hidden_source_process"]'),
		1,
		"hidden source fixture rendered",
	);
	await waitForSourceCloseReady(sourceTab, { timeoutMs: coldRenderTimeoutMs });
	await closeSourceTab(page, sourceTab);
	await frame
		.locator('#inner g.node[data-node-id="hidden_source_process"]')
		.press("Enter");
	const diskSource = `external >> rebuild -> result\n${source}`;
	await writeFile(session.fixturePath, diskSource, "utf8");
	await frame.locator("#connector-kind").selectOption("->");
	await frame.locator("#connector-target").fill("stale_result");
	await frame
		.getByRole("button", { name: "Add connection", exact: true })
		.click();
	await page
		.getByLabel(/, source: PFDSL, notification,/)
		.getByText(
			/^The (?:document changed\. Reopen Node actions and try again\.|file changed outside VS Code\. Reload the source file before editing from the preview\.)$/,
			{ exact: true },
		)
		.waitFor({ state: "visible" });
	assert.equal(await readFile(session.fixturePath, "utf8"), diskSource);
	assert.equal(
		await frame.locator('#inner g.node[data-node-id="stale_result"]').count(),
		0,
	);
	await submitQuickInput(
		page,
		page.getByRole("tab", { name: /^PFDSL Preview/ }),
		`${modifier}+p`,
		"file",
		session.fixturePath,
	);
	await sourceTab.waitFor({ state: "visible" });
	assert.equal(await sourceTab.getAttribute("aria-selected"), "true");
	await submitQuickInput(
		page,
		sourceTab,
		`${modifier}+Shift+p`,
		"command",
		"File: Revert File",
	);
	await page.getByRole("tab", { name: /^PFDSL Preview/ }).click();
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="external"]'),
		1,
		"source reloaded",
	);
	await frame
		.locator('#inner g.node[data-node-id="hidden_source_process"]')
		.press("Enter");
	await frame.locator("#connector-kind").selectOption("->");
	await frame.locator("#connector-target").fill("fresh_result");
	await frame
		.getByRole("button", { name: "Add connection", exact: true })
		.click();
	await waitForColdRender(
		frame.locator('#inner g.node[data-node-id="fresh_result"]'),
		1,
		"fresh connection",
	);
	await sourceTab.click();
	await page.keyboard.press(`${modifier}+s`);
	await waitForInteraction(
		"fresh retry saved without losing external changes",
		() => readFile(session.fixturePath, "utf8"),
		(text) => text === `${diskSource}hidden_source_process -> fresh_result\n`,
		{ timeoutMs: coldRenderTimeoutMs },
	);
	console.log(
		"hidden source external change: stale edit rejected; reload and fresh retry preserved exact source",
	);
}

export async function launchSmokeSession() {
	const runDir = await createRunDirectory();
	const profileDir = join(runDir, "profile");
	let browser;
	let page;
	let processError;
	let vscodeProcess;
	let output;
	try {
		const repoRoot = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../..",
		);
		const port = await reservePort();
		const cachePath = await prepareVSCodeCachePath(repoRoot);
		const cachedExecutablePath = await populateVSCodeCache(
			cachePath,
			vscodeVersion,
			() =>
				downloadAndUnzipVSCode({
					version: vscodeVersion,
					cachePath,
				}),
		);
		const vscodeExecutablePath = resolveVSCodeExecutablePath(
			cachedExecutablePath ??
				(await downloadAndUnzipVSCode({ version: vscodeVersion, cachePath })),
		);
		const fixturePath = join(runDir, "01-simple-chain.pfdsl");
		await copyFile(
			join(repoRoot, "docs/samples/01-simple-chain.pfdsl"),
			fixturePath,
		);
		vscodeProcess = spawn(
			vscodeExecutablePath,
			makeLaunchArgs({
				repoRoot,
				profileDir,
				extensionsDir: join(runDir, "extensions"),
				port,
				fixturePath,
			}),
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		output = {
			stdout: collectOutput(vscodeProcess.stdout),
			stderr: collectOutput(vscodeProcess.stderr),
		};
		vscodeProcess.once("error", (error) => {
			processError = error;
		});
		browser = await connectToVSCode({
			endpoint: `http://127.0.0.1:${port}`,
			output,
			processError,
			vscodeProcess,
		});
		page = await waitForWorkbenchPage(browser);
		await page.getByLabel("PFDSL: Open Preview to the Side").click();
		const frame = await findWebviewFrame(page);
		const session = {
			browser,
			page,
			frame,
			fixturePath,
			profileDir,
			vscodeProcess,
			runDir,
			output,
		};
		return session;
	} catch (error) {
		const diagnostic = formatDiagnostic(error.message, {
			page,
			processError,
			vscodeProcess,
			output,
		});
		const primaryError = await appendExtensionHostLogDiagnostics(
			new Error(diagnostic, { cause: error }),
			profileDir,
		);
		const cleanupErrors = await cleanupSmokeSession({
			browser,
			runDir,
			vscodeProcess,
		});
		throw appendCleanupDiagnostics(primaryError, cleanupErrors);
	}
}

async function main() {
	let session;
	let failure;
	try {
		session = await launchSmokeSession();
		console.log(`VS Code version: ${vscodeVersion}`);
		console.log(`frame URL: ${session.frame.url()}`);
		await waitForColdRender(session.frame.locator("#root"), 1, "preview root");
		await assertVisibleCount(session.frame.locator("#root"), 1, "preview root");
		await waitForColdRender(
			session.frame.locator("#inner svg"),
			1,
			"preview SVG",
		);
		await assertVisibleCount(
			session.frame.locator("#inner svg"),
			1,
			"preview SVG",
		);
		await waitForColdRender(
			session.frame.locator("#inner g.node"),
			3,
			"preview graph nodes",
		);
		await waitForColdRender(session.frame.locator("#minimap"), 1, "minimap");
		await assertVisibleCount(session.frame.locator("#minimap"), 1, "minimap");
		await waitForColdRender(session.frame.locator("g.node"), 6, "sample nodes");
		const nodeCount = await assertVisibleCount(
			session.frame.locator("g.node"),
			6,
			"sample nodes",
		);
		console.log(`sample nodes: ${nodeCount}`);
		await assertGraphFits(session.frame);
		await assertPreviewInteractions(session);
		await assertPreviewUsability(session);
		await assertDefinitionQuickFix(session);
		await assertPreviewEditingFocus(session);
		await assertHiddenSourceExternalChange(session);
	} catch (error) {
		if (!session) {
			failure = error;
		} else {
			console.error(
				"Workbench interaction state:",
				JSON.stringify(
					await collectWorkbenchInteractionState(session.page).catch(
						(stateError) => ({ unavailable: stateError.message }),
					),
				),
			);
			failure = await appendWebviewFailureSnapshot(
				new Error(
					formatDiagnostic(error.message, {
						page: session.page,
						vscodeProcess: session.vscodeProcess,
						output: session.output,
					}),
					{ cause: error },
				),
				session.frame,
			);
			failure = await appendExtensionHostLogDiagnostics(
				failure,
				session.profileDir,
			);
		}
	} finally {
		if (session) {
			const cleanupErrors = await cleanupSmokeSession(session);
			if (cleanupErrors.length > 0) {
				failure = appendCleanupDiagnostics(
					failure ?? new Error("Smoke session completed but cleanup failed"),
					cleanupErrors,
				);
			} else {
				console.log(`cleanup confirmed: ${session.runDir}`);
			}
		}
	}
	if (failure) throw failure;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	main().catch((error) => {
		console.error(error.stack ?? error);
		process.exitCode = 1;
	});
}
