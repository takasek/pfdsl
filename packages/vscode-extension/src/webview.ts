import { Graphviz } from "@hpcc-js/wasm";

type MessageToWebview =
	| { type: "render"; dot: string }
	| { type: "error"; message: string };

type MessageFromWebview =
	| { type: "ready" }
	| { type: "nodeClick"; nodeId: string };

declare const acquireVsCodeApi: () => {
	postMessage: (msg: MessageFromWebview) => void;
};
const vscode = acquireVsCodeApi();

let gv: Awaited<ReturnType<typeof Graphviz.load>> | null = null;

async function getGraphviz() {
	if (!gv) gv = await Graphviz.load();
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

function applyTransform() {
	inner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
	inner.style.transformOrigin = "0 0";
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

root.addEventListener("dblclick", () => {
	scale = 1;
	panX = 0;
	panY = 0;
	applyTransform();
});

inner.addEventListener("click", (e) => {
	const node = (e.target as Element).closest("g.node");
	if (!node) return;
	const title = node.querySelector("title");
	if (!title?.textContent) return;
	vscode.postMessage({ type: "nodeClick", nodeId: title.textContent });
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
	if (msg.type === "error") {
		inner.innerHTML = `<div class="err">${escapeHtml(msg.message)}</div>`;
		return;
	}
	if (msg.type !== "render") return;
	try {
		const g = await getGraphviz();
		const svg = g.dot(msg.dot, "svg");
		inner.innerHTML = svg;
	} catch (e) {
		inner.innerHTML = `<div class="err">${escapeHtml((e as Error).message)}</div>`;
	}
});

vscode.postMessage({ type: "ready" });
