import { Graphviz } from "@hpcc-js/wasm";

type MessageToWebview =
	| { type: "render"; dot: string; focusNodeId?: string }
	| { type: "error"; message: string };

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

let scale = 1;
let panX = 0;
let panY = 0;
let dragging = false;
let startX = 0;
let startY = 0;
let hasPositioned = false;

function applyTransform() {
	inner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
	inner.style.transformOrigin = "0 0";
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

function focusNode(nodeId: string) {
	const nodes = inner.querySelectorAll("g.node");
	for (const node of nodes) {
		const title = node.querySelector("title");
		if (title?.textContent === nodeId) {
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
	if (!dragging) return;
	panX = e.clientX - startX;
	panY = e.clientY - startY;
	applyTransform();
});

window.addEventListener("mouseup", () => {
	dragging = false;
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
	if (msg.type !== "render") return;
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
		if (!hasPositioned) {
			hasPositioned = true;
			const focusNodeId = msg.focusNodeId;
			log("scheduling center, focusNodeId:", focusNodeId);
			requestAnimationFrame(() => {
				log("rAF fired, inner.offsetWidth:", inner.offsetWidth);
				centerGraph();
				if (focusNodeId) focusNode(focusNodeId);
			});
		}
	} catch (e) {
		log("render error:", (e as Error).message);
		inner.innerHTML = `<div class="err">${escapeHtml((e as Error).message)}</div>`;
	}
});

log("sending ready");
vscode.postMessage({ type: "ready" });
