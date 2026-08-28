import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
	readTransform,
	removeRunDirectory,
} from "./harness.mjs";

const vscodeVersion = "1.132.1";
const cdpTimeoutMs = 30_000;
const outputBySession = new WeakMap();

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
	if (
		await Promise.race([
			exited.then(() => true),
			delay(5_000).then(() => false),
		])
	)
		return;
	vscodeProcess.kill("SIGKILL");
	await exited;
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
	if (!match) {
		throw new Error(
			`Status bar does not report a cursor position: ${statusText}`,
		);
	}
	return { line: Number(match[1]), column: Number(match[2]) };
}

function cursorPositionsMatch(actual, expected) {
	return actual.line === expected.line && actual.column === expected.column;
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

async function waitForStatusCursorPosition(page, label) {
	const statusText = await expectEventually(
		label,
		() => readStatusText(page),
		(text) => /Ln \d+, Col \d+\b/.test(text),
	);
	return parseStatusCursorPosition(statusText);
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
	const afterZoom = await expectEventually(
		"zoom increases preview scale",
		() => readTransform(frame),
		(transform) => transform.scale > beforeZoom.scale,
	);
	await expectEventually(
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
	await expectEventually(
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
	await expectEventually(
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
	await expectEventually(
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
	const beforeMinimapDrag = await readTransform(frame);
	await page.mouse.move(
		minimapBox.x + minimapBox.width * 0.25,
		minimapBox.y + minimapBox.height * 0.75,
	);
	await page.mouse.down();
	await page.mouse.move(
		minimapBox.x + minimapBox.width * 0.75,
		minimapBox.y + minimapBox.height * 0.25,
	);
	await page.mouse.up();
	await expectEventually(
		"minimap drag changes preview pan without zooming",
		() => readTransform(frame),
		(transform) =>
			!isWithinGeometryTolerance(transform.panX, beforeMinimapDrag.panX) &&
			!isWithinGeometryTolerance(transform.panY, beforeMinimapDrag.panY) &&
			isWithinScaleTolerance(transform.scale, beforeMinimapDrag.scale),
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
	await expectEventually(
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

export async function launchSmokeSession() {
	const runDir = await createRunDirectory();
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
		const vscodeExecutablePath = resolveVSCodeExecutablePath(
			await downloadAndUnzipVSCode(vscodeVersion),
		);
		const fixturePath = join(repoRoot, "docs/samples/01-simple-chain.pfdsl");
		vscodeProcess = spawn(
			vscodeExecutablePath,
			makeLaunchArgs({
				repoRoot,
				profileDir: join(runDir, "profile"),
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
			vscodeProcess,
			runDir,
		};
		outputBySession.set(session, output);
		return session;
	} catch (error) {
		const diagnostic = formatDiagnostic(error.message, {
			page,
			processError,
			vscodeProcess,
			output,
		});
		const primaryError = new Error(diagnostic, { cause: error });
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
		await waitForVisibleCount(
			session.frame.locator("#root"),
			1,
			"preview root",
		);
		await assertVisibleCount(session.frame.locator("#root"), 1, "preview root");
		await waitForVisibleCount(
			session.frame.locator("#inner svg"),
			1,
			"preview SVG",
		);
		await assertVisibleCount(
			session.frame.locator("#inner svg"),
			1,
			"preview SVG",
		);
		await waitForVisibleCount(
			session.frame.locator("#inner g.node"),
			3,
			"preview graph nodes",
		);
		await waitForVisibleCount(session.frame.locator("#minimap"), 1, "minimap");
		await assertVisibleCount(session.frame.locator("#minimap"), 1, "minimap");
		await waitForVisibleCount(
			session.frame.locator("g.node"),
			6,
			"sample nodes",
		);
		const nodeCount = await assertVisibleCount(
			session.frame.locator("g.node"),
			6,
			"sample nodes",
		);
		console.log(`sample nodes: ${nodeCount}`);
		await assertPreviewInteractions(session);
	} catch (error) {
		if (!session) {
			failure = error;
		} else {
			failure = new Error(
				formatDiagnostic(error.message, {
					page: session.page,
					vscodeProcess: session.vscodeProcess,
					output: outputBySession.get(session),
				}),
				{ cause: error },
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
