import { format } from "@pfdsl/core";
import * as monaco from "monaco-editor/editor/editor.api.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { idsOfStatement } from "../../../packages/vscode-extension/src/preview-logic.ts";
import {
	centerPan,
	zoomAt,
} from "../../../packages/vscode-extension/src/webview-logic.ts";
import baseline from "../generated/baseline.json";
import { guardClose, invoke } from "./bridge.js";
import { Documents } from "./documents.mjs";
import { compile, pngBytes, standaloneSvg } from "./pfd.js";
import "./style.css";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const $ = (id) => document.getElementById(id);
const docs = new Documents();
const models = new Map();
const views = new Map();
const camera = new Map();
let switching = false;
let activeSvg = null;
let renderQueue = Promise.resolve();
let renderTimer;
let verifying = false;
const runtimeErrors = [];
window.addEventListener("error", (event) => runtimeErrors.push(event.message));
window.addEventListener("unhandledrejection", (event) =>
	runtimeErrors.push(String(event.reason)),
);
window.addEventListener("securitypolicyviolation", (event) =>
	runtimeErrors.push(
		`${event.violatedDirective}: ${event.blockedURI} (${event.sample})`,
	),
);
const editor = monaco.editor.create($("editor"), {
	value: "",
	language: "plaintext",
	automaticLayout: true,
	minimap: { enabled: false },
	fontSize: 13,
	lineHeight: 21,
	scrollBeyondLastLine: false,
	tabSize: 2,
	fontFamily: "SFMono-Regular, Menlo, monospace",
	padding: { top: 15 },
});
const read = (path) => invoke("read_document", { path });
function status(message, error = false) {
	$("status").textContent = message;
	$("status").classList.toggle("error", error);
}
function updateTabs() {
	$("tabs").replaceChildren(
		...[...docs.tabs.values()].map((doc) => {
			const button = document.createElement("button");
			button.className = `tab${doc.path === docs.activePath ? " active" : ""}`;
			button.textContent = `${doc.dirty ? "● " : ""}${doc.path.split("/").at(-1)}`;
			button.title = doc.path;
			const close = document.createElement("span");
			close.className = "close";
			close.textContent = "×";
			close.addEventListener("click", async (e) => {
				e.stopPropagation();
				if (
					doc.dirty &&
					!(await confirmDiscard("Discard unsaved changes to this document?"))
				)
					return;
				const wasActive = docs.activePath === doc.path;
				if (!docs.close(doc.path, true)) return;
				if (wasActive) editor.setModel(null);
				models.get(doc.path)?.dispose();
				models.delete(doc.path);
				views.delete(doc.path);
				camera.delete(doc.path);
				activate(docs.activePath);
			});
			button.append(close);
			button.addEventListener("click", () => activate(doc.path));
			return button;
		}),
	);
	$("save").disabled = !docs.active || docs.active.saving;
}
function confirmDiscard(message) {
	return new Promise((resolve) => {
		const dialog = document.createElement("dialog");
		const text = document.createElement("p");
		text.textContent = message;
		const cancel = document.createElement("button");
		cancel.textContent = "Cancel";
		const discard = document.createElement("button");
		discard.textContent = "Discard";
		const finish = (answer) => {
			dialog.close();
			dialog.remove();
			resolve(answer);
		};
		cancel.onclick = () => finish(false);
		discard.onclick = () => finish(true);
		dialog.oncancel = (event) => {
			event.preventDefault();
			finish(false);
		};
		dialog.append(text, cancel, discard);
		document.body.append(dialog);
		dialog.showModal();
	});
}
function activate(path) {
	if (editor.getModel())
		views.set(editor.getModel().uri.path.slice(1), editor.saveViewState());
	switching = true;
	if (path) docs.select(path);
	editor.setModel(path ? models.get(path) : null);
	if (views.has(path)) editor.restoreViewState(views.get(path));
	switching = false;
	activeSvg = null;
	$("drawing").replaceChildren();
	showPreview();
	updateTabs();
	if (docs.active && !docs.active.render) scheduleRender();
}
async function open(path) {
	if (docs.tabs.has(path)) {
		activate(path);
		return;
	}
	const data = await read(path);
	if (editor.getModel())
		views.set(editor.getModel().uri.path.slice(1), editor.saveViewState());
	docs.open(data.path, data.text);
	const model = monaco.editor.createModel(
		data.text,
		"plaintext",
		monaco.Uri.parse(`inmemory://pfdsl/${data.path}`),
	);
	model.onDidChangeContent(() => {
		if (switching) return;
		docs.edit(data.path, model.getValue());
		updateTabs();
		if (docs.activePath === data.path) {
			showPreview();
			scheduleRender();
		}
	});
	models.set(data.path, model);
	activate(data.path);
}
function scheduleRender() {
	clearTimeout(renderTimer);
	const path = docs.activePath;
	renderTimer = setTimeout(() => {
		renderQueue = renderQueue.then(async () => {
			const doc = docs.tabs.get(path);
			if (!doc || docs.activePath !== path || doc.render) return;
			const revision = doc.revision;
			try {
				const output = await compile(path, doc.text, read);
				if (!docs.rendered(path, revision, output)) return;
				monaco.editor.setModelMarkers(
					models.get(path),
					"pfdsl",
					output.diagnostics.map((d) => ({
						severity:
							d.severity === "error"
								? monaco.MarkerSeverity.Error
								: monaco.MarkerSeverity.Warning,
						message: `${d.code}: ${d.message}`,
						startLineNumber: Math.max(1, d.range.start.line),
						startColumn: Math.max(1, d.range.start.column),
						endLineNumber: Math.max(1, d.range.end.line),
						endColumn: Math.max(1, d.range.end.column),
					})),
				);
				if (docs.activePath === path) showPreview();
			} catch (error) {
				if (
					docs.rendered(path, revision, {
						error: String(error),
						diagnostics: [],
					}) &&
					docs.activePath === path
				)
					showPreview();
			}
		});
	}, 180);
}
function showPreview() {
	const doc = docs.active;
	const output = doc?.render;
	const valid = !!output?.svg;
	$("placeholder").hidden = valid;
	$("placeholder").textContent =
		output?.error ?? (doc ? "Updating preview…" : "Open a document");
	for (const id of ["svg", "png", "pdf"]) $(id).disabled = !valid;
	if (activeSvg !== output?.svg) {
		$("drawing").replaceChildren();
		activeSvg = output?.svg ?? null;
		if (valid) {
			const normalized = standaloneSvg(output.svg);
			const parsed = new DOMParser().parseFromString(
				normalized.svg,
				"image/svg+xml",
			);
			// Links are interpreted by the host, never navigated as raw SVG URLs.
			for (const anchor of parsed.querySelectorAll("a"))
				anchor.replaceWith(...anchor.childNodes);
			$("drawing").append(document.importNode(parsed.documentElement, true));
			if (!camera.has(doc.path)) fit();
			else applyCamera();
		}
	}
	if (doc?.conflict)
		status(
			"File changed externally. Your edits are preserved; saving is blocked until you resolve the conflict.",
			true,
		);
	else if (output?.error) status(output.error, true);
	else if (valid) {
		status(
			`${doc.path} · ${output.diagnostics.length} diagnostics${doc.dirty ? " · Unsaved" : ""}`,
		);
		$("metrics").textContent =
			`${Math.round(output.renderMs)} ms render · ${docs.tabs.size} tabs`;
	}
}
function fit() {
	const doc = docs.active;
	if (!doc?.render?.svg) return;
	const { width, height } = standaloneSvg(doc.render.svg);
	const rect = $("preview").getBoundingClientRect();
	const scale = Math.min(
		1.5,
		(rect.width - 40) / width,
		(rect.height - 40) / height,
	);
	camera.set(doc.path, { scale, ...centerPan(rect, { width, height }, scale) });
	applyCamera();
}
function applyCamera() {
	const view = camera.get(docs.activePath);
	if (!view) return;
	$("drawing").style.transform =
		`translate(${view.panX}px,${view.panY}px) scale(${view.scale})`;
	$("zoom").textContent = `${Math.round(view.scale * 100)}%`;
}
$("preview").addEventListener(
	"wheel",
	(event) => {
		event.preventDefault();
		const view = camera.get(docs.activePath);
		if (!view) return;
		const rect = $("preview").getBoundingClientRect();
		camera.set(
			docs.activePath,
			zoomAt(
				view,
				event.clientX - rect.left,
				event.clientY - rect.top,
				event.deltaY,
			),
		);
		applyCamera();
	},
	{ passive: false },
);
let drag;
$("preview").addEventListener("pointerdown", (event) => {
	const view = camera.get(docs.activePath);
	if (!view) return;
	drag = {
		x: event.clientX,
		y: event.clientY,
		path: docs.activePath,
		view: { ...view },
		moved: false,
	};
	$("preview").setPointerCapture(event.pointerId);
});
$("preview").addEventListener("pointermove", (event) => {
	if (!drag || drag.path !== docs.activePath) return;
	const dx = event.clientX - drag.x,
		dy = event.clientY - drag.y;
	if (Math.hypot(dx, dy) > 4) drag.moved = true;
	camera.set(drag.path, {
		...drag.view,
		panX: drag.view.panX + dx,
		panY: drag.view.panY + dy,
	});
	applyCamera();
});
$("preview").addEventListener("pointerup", (event) => {
	const moved = drag?.moved;
	drag = null;
	if (moved) return;
	const node = document
		.elementFromPoint(event.clientX, event.clientY)
		?.closest("g.node");
	const id = node?.querySelector("title")?.textContent;
	const output = docs.active?.render;
	if (!id || !output) return;
	const occurrence = output.result.document.statements
		.flatMap(idsOfStatement)
		.find((item) => item.value === id);
	if (occurrence) {
		editor.setPosition({
			lineNumber: occurrence.start.line,
			column: occurrence.start.column,
		});
		editor.revealLineInCenter(occurrence.start.line);
		editor.focus();
	}
});
async function save() {
	if (!docs.active) return;
	const path = docs.activePath;
	try {
		const pending = docs.save(path, (path, text, expectedText) =>
			invoke("write_document", { path, text, expectedText }),
		);
		updateTabs();
		await pending;
		status(`Saved ${path}`);
	} catch (error) {
		status(String(error), true);
	}
	updateTabs();
}
async function exportDiagram(
	kind,
	output = docs.active?.render,
	stem = docs.activePath
		?.split("/")
		.at(-1)
		?.replace(/\.pfdsl$/, ""),
) {
	if (!output?.svg) throw new Error("Preview is not ready");
	const { svg, width, height } = standaloneSvg(output.svg);
	const path = `exports/${stem}.${kind}`;
	if (kind === "pdf") await invoke("export_pdf", { svg, width, height, path });
	else {
		const bytes =
			kind === "png"
				? await pngBytes(svg, width, height)
				: Array.from(new TextEncoder().encode(svg));
		await invoke("write_export", { path, bytes });
	}
	status(`Exported ${path} · ${width} × ${height}`);
	return { path, width, height };
}
$("open").onclick = () =>
	open($("files").value).catch((error) => status(String(error), true));
$("save").onclick = save;
$("fit").onclick = fit;
$("format").onclick = () => {
	if (!docs.active) return;
	const result = format(docs.active.text);
	if (result.diagnostics.some((d) => d.severity === "error")) {
		status("Resolve errors before formatting", true);
		return;
	}
	editor.pushUndoStop();
	editor.executeEdits("pfdsl-format", [
		{ range: editor.getModel().getFullModelRange(), text: result.output },
	]);
	editor.pushUndoStop();
};
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
for (const kind of ["svg", "png", "pdf"])
	$(kind).onclick = () =>
		exportDiagram(kind).catch((error) => status(String(error), true));

async function verifySamples() {
	if (verifying) return;
	verifying = true;
	$("verify").disabled = true;
	const styles = [
		".view-line",
		".mtk1",
		".line-numbers",
		".lines-content",
		".monaco-editor",
	].map((selector) => {
		const element = document.querySelector(selector);
		const style = element && getComputedStyle(element);
		return {
			selector,
			rect: element?.getBoundingClientRect().toJSON(),
			color: style?.color,
			display: style?.display,
			visibility: style?.visibility,
			position: style?.position,
			background: style?.backgroundColor,
		};
	});
	const report = {
		sourceCommit: baseline.sourceCommit,
		userAgent: navigator.userAgent,
		createdAt: new Date().toISOString(),
		viewport: { width: innerWidth, height: innerHeight },
		ui: {
			container: $("editor").getBoundingClientRect().toJSON(),
			layout: editor.getLayoutInfo(),
			modelLines: editor.getModel()?.getLineCount(),
			styles,
			csp: [
				...document.querySelectorAll(
					'meta[http-equiv="Content-Security-Policy"]',
				),
			].map((meta) => meta.content),
			runtimeErrors,
		},
		cases: [],
		exports: [],
	};
	try {
		await renderQueue;
		for (const expected of baseline.cases) {
			status(`Verifying ${expected.path}`);
			const data = await read(expected.path);
			const start = performance.now();
			const output = await compile(data.path, data.text, read);
			const diagnostics = output.diagnostics.map((d) => [
				d.code,
				d.severity,
				d.message,
			]);
			const actualFormat = format(data.text).output;
			const matched =
				data.text === expected.source &&
				output.dot === expected.dot &&
				actualFormat === expected.formatted &&
				JSON.stringify(diagnostics) === JSON.stringify(expected.diagnostics);
			report.cases.push({
				path: data.path,
				matched,
				elapsedMs: performance.now() - start,
				nodes: output.result.graph.nodes.size,
				svgBytes: new TextEncoder().encode(output.svg).length,
			});
			if (
				[
					"05-label-cjk.pfdsl",
					"13-preset.pfdsl",
					"pfdsl_implementation_flow.pfdsl",
				].some((name) => data.path.endsWith(`/${name}`))
			) {
				for (const kind of ["svg", "png", "pdf"])
					report.exports.push(
						await exportDiagram(
							kind,
							output,
							data.path
								.split("/")
								.at(-1)
								.replace(/\.pfdsl$/, ""),
						),
					);
			}
		}
		report.passed = report.cases.every((item) => item.matched);
		report.completedAt = new Date().toISOString();
		await invoke("write_export", {
			path: "exports/probe-report.json",
			bytes: Array.from(
				new TextEncoder().encode(JSON.stringify(report, null, 2)),
			),
		});
		status(
			`${report.cases.length} documents verified · ${report.passed ? "All matched" : "Mismatch found"} · Report saved`,
			!report.passed,
		);
	} catch (error) {
		report.error = String(error);
		report.passed = false;
		await invoke("write_export", {
			path: "exports/probe-report.json",
			bytes: Array.from(
				new TextEncoder().encode(JSON.stringify(report, null, 2)),
			),
		}).catch(() => {});
		status(String(error), true);
	} finally {
		verifying = false;
		$("verify").disabled = false;
	}
}
$("verify").onclick = verifySamples;

// Poll only open documents; disk changes never silently replace a dirty buffer.
let polling = false;
setInterval(async () => {
	if (verifying || polling) return;
	polling = true;
	try {
		for (const doc of docs.tabs.values()) {
			const snapshot = docs.snapshot(doc.path);
			try {
				const disk = await read(doc.path);
				const refreshed = docs.refresh(doc.path, disk.text, snapshot);
				if (refreshed === "reloaded") {
					switching = true;
					models.get(doc.path).setValue(doc.text);
					switching = false;
					if (doc.path === docs.activePath) {
						showPreview();
						scheduleRender();
					}
				} else if (refreshed === "conflict" && doc.path === docs.activePath)
					showPreview();
			} catch (error) {
				if (doc.path === docs.activePath)
					status(`Cannot reload: ${error}`, true);
			}
		}
	} finally {
		polling = false;
	}
}, 1200);

guardClose(async () => {
	if ([...docs.tabs.values()].some((doc) => doc.saving)) return false;
	if (![...docs.tabs.values()].some((doc) => doc.dirty)) return true;
	return confirmDiscard("Discard all unsaved changes and close?");
}).catch((error) => status(String(error), true));

try {
	const files = await invoke("list_documents");
	for (const file of files) {
		const option = document.createElement("option");
		option.value = file.path;
		option.textContent = file.name;
		$("files").append(option);
	}
	await open("docs/samples/01-simple-chain.pfdsl");
} catch (error) {
	status(String(error), true);
}
