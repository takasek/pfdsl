import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";

let closeOrdinal = 0;
export async function installTrace(page) {
	if (!process.env.PFDSL_DOM_LOG) return;
	await bestEffort("install DOM trace", () =>
		page.evaluate(() => {
			const records = [];
			const ids = new WeakMap();
			let sequence = 0;
			const id = (e) => {
				if (!e) return null;
				if (!ids.has(e)) ids.set(e, ++sequence);
				return ids.get(e);
			};
			const describe = (e) =>
				e instanceof Element
					? {
							id: id(e),
							tag: e.tagName,
							class: String(e.className).slice(0, 160),
							role: e.getAttribute("role"),
							label: e.getAttribute("aria-label"),
							title: e.getAttribute("title"),
							connected: e.isConnected,
						}
					: null;
			const state = () => ({
				focused: document.hasFocus(),
				active: describe(document.activeElement),
				groups: [...document.querySelectorAll(".editor-group-container")].map(
					(g) => ({
						...describe(g),
						attrs: Object.fromEntries(
							[...g.attributes]
								.filter((a) => /id|data-/.test(a.name))
								.map((a) => [a.name, a.value]),
						),
						tabs: [...g.querySelectorAll('[role="tab"]')].map((t) => ({
							...describe(t),
							selected: t.getAttribute("aria-selected"),
							visible: !!t.getClientRects().length,
						})),
					}),
				),
				dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
					describe,
				),
			});
			const record = (event, details = {}) => {
				if (records.length < 5000)
					records.push({
						wallMs: Date.now(),
						monoMs: performance.now(),
						event,
						details,
						state: state(),
					});
				else if (records.length === 5000)
					records.push({
						wallMs: Date.now(),
						event: "trace-truncated",
						details: { maximumRecords: 5000 },
					});
			};
			for (const name of [
				"pointerdown",
				"pointerup",
				"mousedown",
				"mouseup",
				"click",
				"dblclick",
				"focusin",
				"focusout",
			])
				document.addEventListener(
					name,
					(e) => {
						if (
							!(e.target instanceof Element) ||
							!e.target.closest(".editor-group-container")
						)
							return;
						record(name, {
							target: describe(e.target),
							path: e.composedPath().slice(0, 6).map(describe),
							x: e.clientX,
							y: e.clientY,
							button: e.button,
							buttons: e.buttons,
							trusted: e.isTrusted,
							defaultPrevented: e.defaultPrevented,
							hit:
								e.clientX !== undefined
									? describe(document.elementFromPoint(e.clientX, e.clientY))
									: null,
						});
					},
					true,
				);
			new MutationObserver((mutations) => {
				const relevant = mutations.filter(
					(m) =>
						(m.target instanceof Element &&
							m.target.matches(
								'.editor-group-container, [role="tab"], [role="tab"] *',
							)) ||
						[...m.addedNodes, ...m.removedNodes].some(
							(e) =>
								e instanceof Element &&
								(e.matches('.editor-group-container, [role="tab"]') ||
									e.querySelector('.editor-group-container, [role="tab"]')),
						),
				);
				if (relevant.length)
					record(
						"mutation",
						relevant.slice(0, 30).map((m) => ({
							kind: m.type,
							attribute: m.attributeName,
							old: m.oldValue,
							target: describe(m.target),
							added: [...m.addedNodes].map(describe),
							removed: [...m.removedNodes].map(describe),
						})),
					);
			}).observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeOldValue: true,
				attributeFilter: ["class", "aria-label", "aria-selected"],
			});
			window.__pfdslDiagnostic = { records, record, state };
			record("trace-ready");
		}),
	);
}
export async function bestEffort(label, operation, { timeoutMs = 1_000 } = {}) {
	let timer;
	try {
		return await Promise.race([
			operation(),
			new Promise((_, reject) => {
				timer = setTimeout(
					() =>
						reject(new Error(`Diagnostic deadline exceeded (${timeoutMs} ms)`)),
					timeoutMs,
				);
			}),
		]);
	} catch (error) {
		console.warn(
			"Diagnostic unavailable:",
			label,
			error?.message ?? String(error),
		);
	} finally {
		clearTimeout(timer);
	}
}
export async function checkpoint(page, label) {
	if (!process.env.PFDSL_DOM_LOG) return;
	return bestEffort(label, async () => {
		const snapshot = await page.evaluate((label) => {
			window.__pfdslDiagnostic?.record(label);
			return window.__pfdslDiagnostic?.state();
		}, label);
		console.log(
			"Diagnostic checkpoint:",
			JSON.stringify({ wallMs: Date.now(), label, snapshot }),
		);
	});
}
export async function closeTrace(page, sourceTab, operation) {
	if (!process.env.PFDSL_DOM_LOG) return operation();
	const ordinal = ++closeOrdinal;
	await checkpoint(page, `close-${ordinal}-before`);
	await bestEffort("close target", async () => {
		console.log(
			"Diagnostic close target:",
			JSON.stringify(
				await sourceTab
					.getByRole("button", { name: /^Close \(/ })
					.evaluate((e) => ({
						label: e.getAttribute("aria-label"),
						title: e.getAttribute("title"),
						rect: e.getBoundingClientRect().toJSON(),
						disabled: e.getAttribute("aria-disabled"),
						tab: e.closest('[role="tab"]')?.outerHTML.slice(0, 1800),
					})),
			),
		);
	});
	try {
		const result = await operation();
		await checkpoint(page, `close-${ordinal}-fulfilled`);
		return result;
	} catch (error) {
		await checkpoint(page, `close-${ordinal}-failed`);
		throw error;
	} finally {
		await flushTrace(page);
	}
}

export async function flushTrace(page) {
	if (!process.env.PFDSL_DOM_LOG || !page) return;
	await bestEffort("DOM trace file", async () =>
		writeFile(
			process.env.PFDSL_DOM_LOG,
			JSON.stringify(
				await page.evaluate(() => window.__pfdslDiagnostic?.records),
				null,
				2,
			),
		),
	);
}

export async function preserveSession({
	page,
	profileDir,
	fixturePath,
	output,
	vscodeProcess,
}) {
	const root = process.env.PFDSL_EVIDENCE_DIR;
	if (!root) return;
	if (vscodeProcess)
		await bestEffort("process identity", () =>
			writeFile(
				join(root, "code-process.json"),
				JSON.stringify(
					{
						pid: vscodeProcess.pid,
						spawnfile: vscodeProcess.spawnfile,
						spawnargs: vscodeProcess.spawnargs,
						exitCode: vscodeProcess.exitCode,
						signalCode: vscodeProcess.signalCode,
					},
					null,
					2,
				),
			),
		);
	await flushTrace(page);
	if (page)
		await bestEffort("screenshot", () =>
			page.screenshot({
				path: join(root, "workbench-final.png"),
				timeout: 1_000,
			}),
		);
	if (profileDir)
		await bestEffort("Code logs", () =>
			cp(join(profileDir, "logs"), join(root, "code-logs"), {
				recursive: true,
			}),
		);
	if (fixturePath)
		await bestEffort("fixture", () =>
			cp(fixturePath, join(root, "fixture-final.pfdsl")),
		);
	if (output) {
		await bestEffort("Code stdout", () =>
			writeFile(join(root, "code.stdout.txt"), output.stdout()),
		);
		await bestEffort("Code stderr", () =>
			writeFile(join(root, "code.stderr.txt"), output.stderr()),
		);
	}
}
