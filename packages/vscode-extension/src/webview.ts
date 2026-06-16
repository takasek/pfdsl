import { Graphviz } from "@hpcc-js/wasm";

type MessageToWebview =
	| {
			type: "render";
			dot: string;
			focusNodeId?: string;
			descriptions?: Record<string, string>;
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
	| { type: "nodeClick"; nodeId: string };

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

let descriptions: Record<string, string> = {};
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

root.addEventListener("mousemove", (e) => {
	const node = (e.target as Element).closest?.("g.node");
	if (!node) {
		tooltip.style.display = "none";
		return;
	}
	const nodeId = node.querySelector("title")?.textContent;
	const desc = nodeId ? descriptions[nodeId] : undefined;
	if (!desc) {
		tooltip.style.display = "none";
		return;
	}
	tooltip.textContent = desc;
	tooltip.style.left = `${e.clientX + 14}px`;
	tooltip.style.top = `${e.clientY + 14}px`;
	tooltip.style.display = "block";
});

root.addEventListener("mouseleave", () => {
	tooltip.style.display = "none";
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
	for (const node of inner.querySelectorAll("g.node.pfdsl-focused")) {
		node.classList.remove("pfdsl-focused");
	}
	lastFocusedNodeId = undefined;
}

function focusNode(nodeId: string) {
	const nodes = inner.querySelectorAll("g.node");
	for (const node of nodes) {
		const title = node.querySelector("title");
		if (title?.textContent === nodeId) {
			for (const n of nodes) n.classList.remove("pfdsl-focused");
			lastFocusedNodeId = nodeId;
			node.classList.add("pfdsl-focused");
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

root.addEventListener("dblclick", (e) => {
	const node = (e.target as Element).closest("g.node");
	if (node) {
		const title = node.querySelector("title");
		if (title?.textContent) {
			vscode.postMessage({ type: "nodeClick", nodeId: title.textContent });
			return;
		}
	}
	scale = 1;
	panX = 0;
	panY = 0;
	requestAnimationFrame(() => centerGraph());
});

minimap.addEventListener("mousedown", (e) => {
	e.stopPropagation();
	minimapDragging = true;
	minimapDragRect = minimap.getBoundingClientRect();
	panToMinimapPoint(e.clientX, e.clientY);
});
minimap.addEventListener("dblclick", (e) => {
	e.stopPropagation();
});
minimap.addEventListener(
	"wheel",
	(e) => {
		e.stopPropagation();
	},
	{ passive: true },
);

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
	try {
		const g = await getGraphviz();
		log("calling g.dot()");
		const svg = g.dot(msg.dot, "svg");
		log("svg length:", svg.length);
		inner.innerHTML = svg;
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
