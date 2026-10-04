import type { DiffReport } from "@pfdsl/core";
import { renderDotToSvg } from "@pfdsl/preview-engine/renderer";
import { buildDiffPanelHtml } from "./diff-panel.js";
import type { MessageFromWebview, MessageToWebview } from "./messages.js";
import { previewMarkup } from "./preview-shell.js";
import { unwrapAnchors } from "./svg-anchors.js";
import {
	centerPan,
	minimapScale,
	minimapViewport,
	panFromMinimapPoint,
	panToCenterNode,
	shouldReleaseDrag,
	zoomAt,
} from "./webview-logic.js";

export interface PreviewHost {
	postMessage(message: MessageFromWebview): void;
	renderDot?: (dot: string) => Promise<string>;
}
/** Mount one independent preview. Transport and lifetime belong to its host. */
export function mountPreview(container: HTMLElement, host: PreviewHost) {
	const document = container.ownerDocument;
	const window = document.defaultView!;
	const abort = new window.AbortController();
	let disposed = false;
	let revision = 0;
	container.classList.add("pfdsl-preview");
	container.innerHTML = previewMarkup;
	const renderDot = host.renderDot ?? renderDotToSvg;
	function on<K extends keyof GlobalEventHandlersEventMap>(
		target: EventTarget,
		type: K,
		callback: (e: GlobalEventHandlersEventMap[K]) => void,
		options?: AddEventListenerOptions,
	) {
		target.addEventListener(type, callback as EventListener, {
			...options,
			signal: abort.signal,
		});
	}
	function requestAnimationFrame(callback: FrameRequestCallback) {
		window.requestAnimationFrame((time) => {
			if (!disposed) callback(time);
		});
	}
	const root = container.querySelector("#root") as HTMLDivElement;
	const inner = container.querySelector("#inner") as HTMLDivElement;
	const tooltip = container.querySelector("#tooltip") as HTMLDivElement;

	let descriptions: Record<string, Array<[string, string]>> = {};
	let locations: Record<string, string[]> = {};
	let subflows: Record<string, string> = {};
	let lastFocusedNodeId: string | undefined;

	const diffPanel = container.querySelector("#diff-panel") as HTMLDivElement;
	let currentDiff: DiffReport | null = null;

	function renderDiffPanel(report: DiffReport): void {
		diffPanel.innerHTML = buildDiffPanelHtml(report);
		diffPanel.style.display = "block";
	}

	function clearDiffPanel(): void {
		currentDiff = null;
		diffPanel.innerHTML = "";
		diffPanel.style.display = "none";
	}

	const modKey = window.navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl";

	on(root, "mousemove", (e) => {
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

	on(root, "mouseleave", (e) => {
		tooltip.style.display = "none";
		if (e.buttons === 0) {
			dragging = false;
			root.style.cursor = "grab";
		}
	});

	const MINIMAP_W = 160;
	const MINIMAP_H = 120;
	const minimap = container.querySelector("#minimap") as HTMLDivElement;
	const minimapSvg = container.querySelector("#minimap-svg") as HTMLDivElement;
	const minimapVp = container.querySelector("#minimap-vp") as HTMLDivElement;
	let mmScale = 1;
	let svgNatW = 0;
	let svgNatH = 0;

	function updateMinimapVp() {
		if (!svgNatW || !svgNatH) return;
		const vp = minimapViewport(
			{ scale, panX, panY },
			{ width: root.clientWidth, height: root.clientHeight },
			mmScale,
		);
		minimapVp.style.left = `${vp.left}px`;
		minimapVp.style.top = `${vp.top}px`;
		minimapVp.style.width = `${vp.width}px`;
		minimapVp.style.height = `${vp.height}px`;
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
		mmScale = minimapScale(
			{ width: svgNatW, height: svgNatH },
			{ width: MINIMAP_W, height: MINIMAP_H },
		);
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
		({ panX, panY } = panFromMinimapPoint(
			clientX,
			clientY,
			minimapDragRect ?? minimap.getBoundingClientRect(),
			mmScale,
			scale,
			{ width: root.clientWidth, height: root.clientHeight },
		));
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
		({ panX, panY } = centerPan(
			{ width: root.clientWidth, height: root.clientHeight },
			{ width: w, height: h },
			scale,
		));
		applyTransform();
	}

	function focusNode(nodeId: string) {
		lastFocusedNodeId = nodeId;
		const nodes = inner.querySelectorAll("g.node");
		for (const node of nodes) {
			if ((node as HTMLElement).dataset.nodeId === nodeId) {
				({ panX, panY } = panToCenterNode(
					{ scale, panX, panY },
					node.getBoundingClientRect(),
					root.getBoundingClientRect(),
					{ width: root.clientWidth, height: root.clientHeight },
				));
				applyTransform();
				return;
			}
		}
	}

	on(
		root,
		"wheel",
		(e) => {
			e.preventDefault();
			const rect = root.getBoundingClientRect();
			({ scale, panX, panY } = zoomAt(
				{ scale, panX, panY },
				e.clientX - rect.left,
				e.clientY - rect.top,
				e.deltaY,
			));
			applyTransform();
		},
		{ passive: false },
	);

	on(root, "mousedown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		dragging = true;
		startX = e.clientX - panX;
		startY = e.clientY - panY;
		root.style.cursor = "grabbing";
	});

	on(window, "mousemove", (e) => {
		if (
			shouldReleaseDrag(e.buttons, {
				graph: dragging,
				minimap: minimapDragging,
			})
		) {
			releaseDrag();
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

	function releaseDrag() {
		dragging = false;
		minimapDragging = false;
		minimapDragRect = null;
		root.style.cursor = "grab";
	}
	on(window, "mouseup", releaseDrag);

	on(root, "click", (e) => {
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
				host.postMessage({ type: "openFile", path: subflow });
			} else if (nodeLocs.length > 0 && nodeId) {
				host.postMessage({ type: "openLocation", nodeId });
			}
		}
	});

	on(root, "dblclick", (e) => {
		const node = (e.target as Element).closest("g.node");
		if (node) {
			const nodeId = (node as HTMLElement).dataset.nodeId;
			if (nodeId) {
				host.postMessage({ type: "nodeClick", nodeId });
				return;
			}
		}
		scale = 1;
		panX = 0;
		panY = 0;
		requestAnimationFrame(() => centerGraph());
	});

	on(minimap, "mousedown", (e) => {
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

	async function receive(msg: MessageToWebview) {
		if (disposed) return;
		const currentRevision =
			msg.type === "render" || msg.type === "error" ? ++revision : revision;
		if (msg.type === "error") {
			inner.innerHTML = `<div class="err">${escapeHtml(msg.message)}</div>`;
			return;
		}
		if (msg.type === "focus") {
			focusNode(msg.nodeId);
			return;
		}
		if (msg.type === "clearFocus") {
			lastFocusedNodeId = undefined;
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
		if (msg.focusNodeId !== undefined) lastFocusedNodeId = msg.focusNodeId;
		descriptions = msg.descriptions ?? {};
		locations = msg.locations ?? {};
		subflows = msg.subflows ?? {};
		try {
			const svg = await renderDot(msg.dot);
			if (disposed || currentRevision !== revision) return;
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
			requestAnimationFrame(() => {
				if (currentRevision !== revision) return;
				if (root.clientWidth === 0 || root.clientHeight === 0) return;
				if (!hasPositioned) {
					centerGraph();
					hasPositioned = true;
				}
				if (lastFocusedNodeId) focusNode(lastFocusedNodeId);
				refreshMinimap();
			});
			if (currentDiff) renderDiffPanel(currentDiff);
		} catch (e) {
			if (disposed || currentRevision !== revision) return;
			inner.innerHTML = `<div class="err">${escapeHtml((e as Error).message)}</div>`;
		}
	}

	host.postMessage({ type: "ready" });
	return {
		receive,
		dispose() {
			disposed = true;
			revision++;
			abort.abort();
		},
	};
}
