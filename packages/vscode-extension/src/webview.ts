import { Graphviz } from "@hpcc-js/wasm";
import { unwrapAnchors } from "./svg-anchors.js";

type MessageToWebview =
	| {
			type: "render";
			dot: string;
			focusNodeId?: string;
			descriptions?: Record<string, Array<[string, string]>>;
			locations?: Record<string, string[]>;
			subflows?: Record<string, string>;
	  }
	| { type: "error"; message: string }
	| { type: "focus"; nodeId: string }
	| { type: "clearFocus" }
	| {
			type: "diff";
			report: {
				addedNodes: string[];
				removedNodes: string[];
				addedEdges: string[];
				removedEdges: string[];
				addedFeedback: string[];
				removedFeedback: string[];
			};
	  }
	| { type: "clearDiff" };

type MessageFromWebview =
	| { type: "ready" }
	| { type: "nodeClick"; nodeId: string }
	| { type: "openUrl"; url: string }
	| { type: "openFile"; path: string }
	| { type: "openLocation"; nodeId: string };

declare const acquireVsCodeApi: () => {
	postMessage: (msg: MessageFromWebview) => void;
};
const vscode = acquireVsCodeApi();

const DEBUG =
	(window as unknown as { __PFDSL_DEBUG__?: boolean }).__PFDSL_DEBUG__ ?? false;
function log(...args: unknown[]) {
	if (DEBUG) console.log("[pfdsl]", ...args);
}

log("webview script start");

let gv: Awaited<ReturnType<typeof Graphviz.load>> | null = null;

async function getGraphviz() {
	if (!gv) {
		log("Graphviz.load() start");
		gv = await Graphviz.load();
		log("Graphviz.load() done");
	}
	return gv;
}

const root = document.getElementById("root") as HTMLDivElement;
const inner = document.getElementById("inner") as HTMLDivElement;
const tooltip = document.getElementById("tooltip") as HTMLDivElement;

let descriptions: Record<string, Array<[string, string]>> = {};
let locations: Record<string, string[]> = {};
let subflows: Record<string, string> = {};
let lastFocusedNodeId: string | undefined;

const diffPanel = document.getElementById("diff-panel") as HTMLDivElement;
type StoredDiff = {
	addedNodes: string[];
	removedNodes: string[];
	addedEdges: string[];
	removedEdges: string[];
	addedFeedback: string[];
	removedFeedback: string[];
};
let currentDiff: StoredDiff | null = null;

function renderDiffPanel(report: StoredDiff): void {
	const lines: string[] = [];
	for (const n of report.addedNodes) lines.push(`+ node  ${n}`);
	for (const n of report.removedNodes) lines.push(`- node  ${n}`);
	for (const e of report.addedEdges) lines.push(`+ edge  ${e}`);
	for (const e of report.removedEdges) lines.push(`- edge  ${e}`);
	for (const f of report.addedFeedback) lines.push(`+ feedback  ${f}`);
	for (const f of report.removedFeedback) lines.push(`- feedback  ${f}`);
	if (lines.length === 0) {
		diffPanel.innerHTML = `<span class="diff-none">No structural differences</span>`;
	} else {
		diffPanel.innerHTML = lines
			.map(
				(l) =>
					`<div class="${l.startsWith("+") ? "diff-add" : "diff-remove"}">${escapeHtml(l)}</div>`,
			)
			.join("");
	}
	diffPanel.style.display = "block";
}

function clearDiffPanel(): void {
	currentDiff = null;
	diffPanel.innerHTML = "";
	diffPanel.style.display = "none";
}

const modKey = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl";

root.addEventListener("mousemove", (e) => {
	const node = (e.target as Element).closest?.("g.node");
	if (!node) {
		tooltip.style.display = "none";
		return;
	}
	const nodeId = (node as HTMLElement).dataset.nodeId;
	const desc = nodeId ? descriptions[nodeId] : undefined;
	const nodeLocs = nodeId ? (locations[nodeId] ?? []) : [];
	const subflow = (node as HTMLElement).dataset.subflow;
	const hint = subflow
		? `${modKey}+Click to open subflow`
		: nodeLocs.length > 1
			? `${modKey}+Click to open location…`
			: nodeLocs.length === 1
				? nodeLocs[0]!.includes("://")
					? `${modKey}+Click to open URL`
					: `${modKey}+Click to open file`
				: null;
	if (!desc && !hint) {
		tooltip.style.display = "none";
		return;
	}
	const parts: string[] = [];
	if (desc) {
		let hintInjected = false;
		const rows = desc
			.map(([k, v]) => {
				const vHtml = escapeHtml(v).replace(/\n/g, "<br>");
				let cellExtra = "";
				if (hint && !hintInjected) {
					if (
						(subflow && k === "subflow") ||
						(!subflow && nodeLocs.length > 0 && k === "location")
					) {
						cellExtra = `<div class="tt-hint">${escapeHtml(hint)}</div>`;
						hintInjected = true;
					}
				}
				if (k === "**")
					return `<tr><td colspan="2" class="tt-body"><strong>${vHtml}</strong>${cellExtra}</td></tr>`;
				if (!k)
					return `<tr><td colspan="2" class="tt-body">${vHtml}${cellExtra}</td></tr>`;
				return `<tr><td class="tt-key">${escapeHtml(k)}</td><td class="tt-val">${vHtml}${cellExtra}</td></tr>`;
			})
			.join("");
		parts.push(`<table class="tt-table">${rows}</table>`);
		if (hint && !hintInjected) {
			parts.push(`<div class="tt-hint">${escapeHtml(hint)}</div>`);
		}
	} else if (hint) {
		parts.push(`<div class="tt-hint">${escapeHtml(hint)}</div>`);
	}
	tooltip.innerHTML = parts.join("");
	tooltip.style.left = `${e.clientX + 14}px`;
	tooltip.style.top = `${e.clientY + 14}px`;
	tooltip.style.display = "block";
});

root.addEventListener("mouseleave", (e) => {
	tooltip.style.display = "none";
	if (e.buttons === 0) {
		dragging = false;
		root.style.cursor = "grab";
	}
});

const MINIMAP_W = 160;
const MINIMAP_H = 120;
const minimap = document.getElementById("minimap") as HTMLDivElement;
const minimapSvg = document.getElementById("minimap-svg") as HTMLDivElement;
const minimapVp = document.getElementById("minimap-vp") as HTMLDivElement;
let mmScale = 1;
let svgNatW = 0;
let svgNatH = 0;

function updateMinimapVp() {
	if (!svgNatW || !svgNatH) return;
	const vx = (-panX / scale) * mmScale;
	const vy = (-panY / scale) * mmScale;
	const vw = (root.clientWidth / scale) * mmScale;
	const vh = (root.clientHeight / scale) * mmScale;
	minimapVp.style.left = `${vx}px`;
	minimapVp.style.top = `${vy}px`;
	minimapVp.style.width = `${vw}px`;
	minimapVp.style.height = `${vh}px`;
}

function refreshMinimap() {
	const svgEl = inner.querySelector("svg");
	if (!svgEl) {
		minimap.style.display = "none";
		return;
	}
	svgNatW = inner.offsetWidth;
	svgNatH = inner.offsetHeight;
	if (!svgNatW || !svgNatH) {
		minimap.style.display = "none";
		return;
	}
	mmScale = Math.min(MINIMAP_W / svgNatW, MINIMAP_H / svgNatH);
	const scaledW = svgNatW * mmScale;
	const scaledH = svgNatH * mmScale;
	minimap.style.width = `${scaledW}px`;
	minimap.style.height = `${scaledH}px`;
	const clone = svgEl.cloneNode(true) as SVGSVGElement;
	clone.setAttribute("width", String(scaledW));
	clone.setAttribute("height", String(scaledH));
	clone.style.width = `${scaledW}px`;
	clone.style.height = `${scaledH}px`;
	minimapSvg.replaceChildren(clone);
	minimap.style.display = "block";
	updateMinimapVp();
}

let minimapDragRect: DOMRect | null = null;

function panToMinimapPoint(clientX: number, clientY: number) {
	if (!svgNatW || !svgNatH) return;
	const rect = minimapDragRect ?? minimap.getBoundingClientRect();
	const gx = (clientX - rect.left) / mmScale;
	const gy = (clientY - rect.top) / mmScale;
	panX = root.clientWidth / 2 - gx * scale;
	panY = root.clientHeight / 2 - gy * scale;
	applyTransform();
}

let scale = 1;
let panX = 0;
let panY = 0;
let dragging = false;
let minimapDragging = false;
let startX = 0;
let startY = 0;
let hasPositioned = false;

function applyTransform() {
	inner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
	inner.style.transformOrigin = "0 0";
	updateMinimapVp();
}

function centerGraph() {
	const w = inner.offsetWidth;
	const h = inner.offsetHeight;
	panX = (root.clientWidth - w * scale) / 2;
	panY = (root.clientHeight - h * scale) / 2;
	log("centerGraph", {
		w,
		h,
		rootW: root.clientWidth,
		rootH: root.clientHeight,
		panX,
		panY,
		scale,
	});
	applyTransform();
}

function clearFocusHighlight() {
	lastFocusedNodeId = undefined;
}

function focusNode(nodeId: string) {
	const nodes = inner.querySelectorAll("g.node");
	for (const node of nodes) {
		if ((node as HTMLElement).dataset.nodeId === nodeId) {
			lastFocusedNodeId = nodeId;
			const nodeRect = node.getBoundingClientRect();
			const rootRect = root.getBoundingClientRect();
			panX +=
				root.clientWidth / 2 -
				(nodeRect.left + nodeRect.width / 2 - rootRect.left);
			panY +=
				root.clientHeight / 2 -
				(nodeRect.top + nodeRect.height / 2 - rootRect.top);
			applyTransform();
			return;
		}
	}
}

root.addEventListener(
	"wheel",
	(e) => {
		e.preventDefault();
		const rect = root.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		panX = cx - (cx - panX) * factor;
		panY = cy - (cy - panY) * factor;
		scale = Math.max(0.05, Math.min(10, scale * factor));
		applyTransform();
	},
	{ passive: false },
);

root.addEventListener("mousedown", (e) => {
	dragging = true;
	startX = e.clientX - panX;
	startY = e.clientY - panY;
	root.style.cursor = "grabbing";
});

window.addEventListener("mousemove", (e) => {
	if (e.buttons === 0 && (dragging || minimapDragging)) {
		dragging = false;
		minimapDragging = false;
		minimapDragRect = null;
		root.style.cursor = "grab";
		return;
	}
	if (minimapDragging) {
		panToMinimapPoint(e.clientX, e.clientY);
		return;
	}
	if (!dragging) return;
	panX = e.clientX - startX;
	panY = e.clientY - startY;
	applyTransform();
});

window.addEventListener("mouseup", () => {
	dragging = false;
	minimapDragging = false;
	minimapDragRect = null;
	root.style.cursor = "grab";
});

root.addEventListener("click", (e) => {
	const node = (e.target as Element).closest("g.node");
	if (!node) return;
	const el = node as HTMLElement;
	const subflow = el.dataset.subflow;
	const nodeId = el.dataset.nodeId;
	const nodeLocs = nodeId ? (locations[nodeId] ?? []) : [];
	if (!subflow && nodeLocs.length === 0) return;
	e.preventDefault();
	if (e.metaKey || e.ctrlKey) {
		if (subflow) {
			vscode.postMessage({ type: "openFile", path: subflow });
		} else if (nodeLocs.length > 0 && nodeId) {
			vscode.postMessage({ type: "openLocation", nodeId });
		}
	}
});

root.addEventListener("dblclick", (e) => {
	const node = (e.target as Element).closest("g.node");
	if (node) {
		const nodeId = (node as HTMLElement).dataset.nodeId;
		if (nodeId) {
			vscode.postMessage({ type: "nodeClick", nodeId });
			return;
		}
	}
	scale = 1;
	panX = 0;
	panY = 0;
	requestAnimationFrame(() => centerGraph());
});

minimap.addEventListener("mousedown", (e) => {
	minimapDragging = true;
	minimapDragRect = minimap.getBoundingClientRect();
	panToMinimapPoint(e.clientX, e.clientY);
});

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

window.addEventListener("message", async (event) => {
	const msg = event.data as MessageToWebview;
	log("message received:", msg.type);
	if (msg.type === "error") {
		inner.innerHTML = `<div class="err">${escapeHtml(msg.message)}</div>`;
		return;
	}
	if (msg.type === "focus") {
		focusNode(msg.nodeId);
		return;
	}
	if (msg.type === "clearFocus") {
		clearFocusHighlight();
		return;
	}
	if (msg.type === "diff") {
		currentDiff = msg.report;
		renderDiffPanel(msg.report);
		return;
	}
	if (msg.type === "clearDiff") {
		clearDiffPanel();
		return;
	}
	if (msg.type !== "render") return;
	descriptions = msg.descriptions ?? {};
	locations = msg.locations ?? {};
	subflows = msg.subflows ?? {};
	try {
		const g = await getGraphviz();
		log("calling g.dot()");
		const svg = g.dot(msg.dot, "svg");
		log("svg length:", svg.length);
		inner.innerHTML = svg;
		for (const node of inner.querySelectorAll("g.node")) {
			const titleEl = node.querySelector(":scope > title");
			if (titleEl?.textContent) {
				const id = titleEl.textContent;
				(node as HTMLElement).dataset.nodeId = id;
				const sf = subflows[id];
				if (sf) (node as HTMLElement).dataset.subflow = sf;
				titleEl.remove();
			}
		}
		// Unwrap graphviz URL anchors: VSCode's handleInnerClick crashes
		// (DataCloneError) on SVGAElement.href, so the <a> must be removed
		// entirely. Cmd+Click is handled via dataset.location instead.
		unwrapAnchors(inner);
		for (const el of inner.querySelectorAll("[*|title], title")) {
			if (el.tagName === "title") el.remove();
			else el.removeAttributeNS("http://www.w3.org/1999/xlink", "title");
		}
		const svgEl = inner.querySelector("svg");
		if (svgEl) {
			log(
				"svg size:",
				svgEl.getAttribute("width"),
				svgEl.getAttribute("height"),
			);
		}
		const focusNodeId = msg.focusNodeId;
		const shouldCenter = !hasPositioned;
		hasPositioned = true;
		requestAnimationFrame(() => {
			if (shouldCenter) {
				log("rAF fired, inner.offsetWidth:", inner.offsetWidth);
				centerGraph();
				if (focusNodeId) focusNode(focusNodeId);
			} else if (lastFocusedNodeId) {
				focusNode(lastFocusedNodeId);
			}
			refreshMinimap();
		});
		if (currentDiff) renderDiffPanel(currentDiff);
	} catch (e) {
		log("render error:", (e as Error).message);
		inner.innerHTML = `<div class="err">${escapeHtml((e as Error).message)}</div>`;
	}
});

log("sending ready");
vscode.postMessage({ type: "ready" });
