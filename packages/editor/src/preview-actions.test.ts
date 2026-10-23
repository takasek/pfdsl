// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { analyzeSnapshot } from "./document.js";
import { mountPreview, NODE_CLICK_DELAY_MS } from "./preview.js";
import { buildPreviewGraph } from "./preview-graph.js";
import { FOCUS_CUE_DURATION_MS, previewStyles } from "./preview-shell.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
const svg =
	'<svg width="200" height="100"><g class="node"><title>a</title><polygon points="0,0 40,0 40,30"/><text>A</text></g><g class="node"><title>p</title><text>P</text></g></svg>';

it("makes unpainted node shapes hit targets only in the main graph", async () => {
	const shapes =
		'<polygon fill="none"/><ellipse fill="none"/><path fill="none"/><rect fill="none"/><circle fill="none"/><polyline fill="none"/>';
	const s = setup(
		vi.fn(async (_dot: string) =>
			svg.replace('<polygon points="0,0 40,0 40,30"/>', shapes),
		),
	);
	await s.preview.receive(s.message);
	for (const shape of s.node("a").querySelectorAll("[fill]")) {
		expect(window.getComputedStyle(shape).pointerEvents).toBe("all");
		expect(shape.getAttribute("fill")).toBe("none");
	}
	expect(
		window.getComputedStyle(s.container.querySelector("#minimap-svg")!)
			.pointerEvents,
	).toBe("none");
	expect(
		window.getComputedStyle(s.container.querySelector("#minimap-svg polygon")!)
			.pointerEvents,
	).not.toBe("all");
});

it.each([
	"click",
	"drag",
	"returning drag",
	"other node",
	"outside",
	"ctrlKey",
	"metaKey",
])("distinguishes a node %s from a Connections click", async (gesture) => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	const modifiers = {
		ctrlKey: gesture === "ctrlKey",
		metaKey: gesture === "metaKey",
	};
	s.node("a")
		.querySelector("polygon")!
		.dispatchEvent(
			new MouseEvent("mousedown", {
				bubbles: true,
				clientX: 20,
				clientY: 20,
				...modifiers,
			}),
		);
	if (gesture.includes("drag"))
		window.dispatchEvent(
			new MouseEvent("mousemove", { buttons: 1, clientX: 60, clientY: 20 }),
		);
	const target =
		gesture === "outside"
			? s.root
			: s.node(gesture === "other node" ? "p" : "a");
	target.dispatchEvent(
		new MouseEvent("mouseup", {
			bubbles: true,
			clientX: gesture === "drag" ? 60 : 22,
			clientY: 21,
			...modifiers,
		}),
	);
	await vi.advanceTimersByTimeAsync(NODE_CLICK_DELAY_MS);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		gesture !== "click",
	);
	if (gesture === "click") {
		expect(s.postMessage).toHaveBeenCalledWith({
			type: "nodeClick",
			nodeId: "a",
			preserveFocus: true,
		});
		expect(
			s.container.querySelector("#node-actions-title")!.textContent,
		).toContain("a");
	}
});

it("replaces the previous selection cue on a click without moving the graph", async () => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	await s.preview.receive({ type: "focus", nodeId: "a" });
	const transform =
		s.container.querySelector<HTMLElement>("#inner")!.style.transform;
	s.node("p").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
	s.node("p").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	await vi.advanceTimersByTimeAsync(NODE_CLICK_DELAY_MS);
	expect(s.node("p").classList.contains("pfdsl-focus-cue")).toBe(true);
	expect(s.node("a").classList.contains("pfdsl-focus-cue")).toBe(false);
	expect(
		s.container.querySelector<HTMLElement>("#inner")!.style.transform,
	).toBe(transform);
});

it.each([
	false,
	true,
])("waits for double-click before changing layout (double-click: %s)", async (doubleClick) => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	s.postMessage.mockClear();
	const panel = s.container.querySelector<HTMLElement>("#node-actions")!;
	const inner = s.container.querySelector<HTMLElement>("#inner")!;
	const transform = inner.style.transform;
	const click = () => {
		s.node("p").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		s.node("p").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	};
	click();
	expect(NODE_CLICK_DELAY_MS).toBe(500);
	await vi.advanceTimersByTimeAsync(NODE_CLICK_DELAY_MS - 1);
	expect(panel.hidden).toBe(true);
	expect(s.postMessage).not.toHaveBeenCalled();
	expect(inner.style.transform).toBe(transform);
	if (doubleClick) {
		click();
		s.node("p").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		expect(panel.hidden).toBe(false);
		expect(
			s.container.querySelector("#node-actions-title")!.textContent,
		).toContain("p");
		await vi.advanceTimersByTimeAsync(501);
		expect(s.postMessage.mock.calls).toEqual([
			[{ type: "nodeClick", nodeId: "p" }],
		]);
	} else {
		await vi.advanceTimersByTimeAsync(1);
		expect(panel.hidden).toBe(false);
		expect(s.postMessage).toHaveBeenCalledWith({
			type: "nodeClick",
			nodeId: "p",
			preserveFocus: true,
		});
	}
});

it.each([
	"redraw",
	"error",
	"dispose",
	"clearFocus",
])("cancels a pending click on %s", async (change) => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	s.postMessage.mockClear();
	s.node("p").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
	s.node("p").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	if (change === "redraw") await s.preview.receive(s.message);
	if (change === "error")
		await s.preview.receive({ type: "error", message: "Broken" });
	if (change === "dispose") s.preview.dispose();
	if (change === "clearFocus") await s.preview.receive({ type: "clearFocus" });
	await vi.advanceTimersByTimeAsync(500);
	expect(s.postMessage).not.toHaveBeenCalled();
});

it("keeps the layout stable while the second press crosses the click deadline", async () => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	s.postMessage.mockClear();
	s.node("p").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
	s.node("p").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	await vi.advanceTimersByTimeAsync(NODE_CLICK_DELAY_MS - 1);
	s.node("p").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
	await vi.advanceTimersByTimeAsync(2);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
	expect(s.postMessage).not.toHaveBeenCalled();
	s.node("p").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	s.node("p").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
	await vi.advanceTimersByTimeAsync(NODE_CLICK_DELAY_MS);
	expect(s.postMessage.mock.calls).toEqual([
		[{ type: "nodeClick", nodeId: "p" }],
	]);
});

it("consumes a synchronization echo once without moving or repeating the cue", async () => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	const inner = s.container.querySelector<HTMLElement>("#inner")!;
	const transform = inner.style.transform;
	const ring = inner.querySelector(".pfdsl-focus-ring");
	await vi.advanceTimersByTimeAsync(100);
	await s.preview.receive({ type: "focus", nodeId: "p" });
	expect(inner.style.transform).toBe(transform);
	expect(inner.querySelector(".pfdsl-focus-ring")).toBe(ring);
	await vi.advanceTimersByTimeAsync(1400);
	expect(inner.querySelector(".pfdsl-focus-ring")).toBeNull();
	await s.preview.receive({ type: "focus", nodeId: "p" });
	expect(inner.querySelector(".pfdsl-focus-ring")).not.toBeNull();
	s.node("p").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	await s.preview.receive({ type: "focus", nodeId: "p" });
	const consumedRing = inner.querySelector(".pfdsl-focus-ring");
	await s.preview.receive({ type: "focus", nodeId: "p" });
	expect(inner.querySelector(".pfdsl-focus-ring")).not.toBe(consumedRing);
});

it.each([
	"Enter",
	"contextmenu",
])("opens immediately with %s and cancels a waiting click", async (gesture) => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	s.postMessage.mockClear();
	s.node("p").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
	s.node("p").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	s.node("a").dispatchEvent(
		gesture === "Enter"
			? new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
			: new MouseEvent("contextmenu", { bubbles: true }),
	);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		false,
	);
	const ring = s.container.querySelector(".pfdsl-focus-ring");
	await vi.advanceTimersByTimeAsync(NODE_CLICK_DELAY_MS);
	expect(s.container.querySelector(".pfdsl-focus-ring")).toBe(ring);
	expect(s.postMessage.mock.calls).toEqual([
		[{ type: "nodeClick", nodeId: "a", preserveFocus: true }],
	]);
});

it.each([
	"different focus",
	"clear focus",
	"timeout",
])("does not retain a missing echo after %s", async (interruption) => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	if (interruption === "different focus")
		await s.preview.receive({ type: "focus", nodeId: "a" });
	if (interruption === "clear focus")
		await s.preview.receive({ type: "clearFocus" });
	if (interruption === "timeout") await vi.advanceTimersByTimeAsync(2000);
	const ring = s.container.querySelector(".pfdsl-focus-ring");
	await s.preview.receive({ type: "focus", nodeId: "p" });
	expect(s.node("p").classList.contains("pfdsl-focus-cue")).toBe(true);
	expect(s.container.querySelector(".pfdsl-focus-ring")).not.toBe(ring);
});

it("synchronizes editor, graph and Connections without taking editor focus", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	const editor = document.createElement("textarea");
	s.container.append(editor);
	editor.focus();
	await s.preview.receive({ type: "focus", nodeId: "a" });
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
	s.node("a").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	editor.focus();
	await s.preview.receive({ type: "focus", nodeId: "p" });
	expect(
		s.container.querySelector("#node-actions-title")!.textContent,
	).toContain("p");
	expect(s.node("p").classList.contains("pfdsl-focus-cue")).toBe(true);
	expect(document.activeElement).toBe(editor);
	s.container.querySelector<HTMLButtonElement>('[data-neighbor="a"]')!.click();
	expect(s.postMessage).toHaveBeenLastCalledWith({
		type: "nodeClick",
		nodeId: "a",
		preserveFocus: true,
	});
	expect(s.node("a").classList.contains("pfdsl-focus-cue")).toBe(true);
	expect(
		s.container
			.querySelector("#node-actions")!
			.contains(document.activeElement),
	).toBe(true);
	s.node("p").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
	expect(
		s.container.querySelector("#node-actions-title")!.textContent,
	).toContain("p");
	expect(s.postMessage).toHaveBeenLastCalledWith({
		type: "nodeClick",
		nodeId: "p",
	});
});

it("offers Go to definition for a defined center and keeps Create definition for an undefined center", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	const definition =
		s.container.querySelector<HTMLButtonElement>("#create-definition")!;
	expect(definition.hidden).toBe(false);
	expect(definition.textContent).toBe("Go to definition");
	definition.click();
	expect(s.postMessage).toHaveBeenLastCalledWith({
		type: "nodeClick",
		nodeId: "p",
	});
	s.container.querySelector<HTMLButtonElement>('[data-neighbor="a"]')!.click();
	expect(definition.textContent).toBe("Create definition");
	definition.click();
	expect(s.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({ type: "createDefinition", nodeId: "a" }),
	);
	expect(s.container.querySelector("#actual-size")!.textContent).toBe(
		"Actual size",
	);
	expect(s.node("a").getAttribute("aria-label")).toContain(
		"Click or press Enter",
	);
});

it("keeps the cue animation and removal deadline at 1500ms", async () => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	await s.preview.receive({ type: "focus", nodeId: "a" });
	expect(FOCUS_CUE_DURATION_MS).toBe(1500);
	const ring = s.container.querySelector<HTMLElement>(".pfdsl-focus-ring")!;
	expect(window.getComputedStyle(ring).animation).toBe(
		"pfdsl-cue 1500ms ease-out",
	);
	await vi.advanceTimersByTimeAsync(1499);
	expect(ring.isConnected).toBe(true);
	await vi.advanceTimersByTimeAsync(1);
	expect(ring.isConnected).toBe(false);
});
function setup(
	renderDot = vi.fn(async (_dot: string) => svg),
	graphSize = { width: 200, height: 100 },
) {
	const schedule = globalThis.setTimeout.bind(globalThis);
	const cancel = globalThis.clearTimeout.bind(globalThis);
	vi.spyOn(window, "setTimeout").mockImplementation((callback, ms) =>
		schedule(callback as () => void, ms),
	);
	vi.spyOn(window, "clearTimeout").mockImplementation((id) => cancel(id));
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
		fn(0);
		return 1;
	});
	const container = document.createElement("div");
	document.body.append(container);
	const postMessage = vi.fn();
	const preview = mountPreview(container, { postMessage, renderDot });
	const style = document.createElement("style");
	style.textContent = previewStyles;
	container.append(style);
	const root = container.querySelector<HTMLElement>("#root")!;
	Object.defineProperties(root, {
		clientWidth: { value: 400 },
		clientHeight: { value: 300 },
	});
	Object.defineProperties(container.querySelector("#inner")!, {
		offsetWidth: { value: graphSize.width },
		offsetHeight: { value: graphSize.height },
	});
	cleanups.push(() => {
		preview.dispose();
		container.remove();
	});
	const source = "a >> p\n";
	const graph = buildPreviewGraph(analyzeSnapshot(source), null);
	const message = {
		type: "render" as const,
		dot: "main",
		graph,
		editing: {
			source,
			nodes: [
				{ id: "a", kind: "artifact" as const, defined: false },
				{ id: "p", kind: "process" as const, defined: true },
			],
		},
	};
	return {
		container,
		preview,
		root,
		postMessage,
		renderDot,
		message,
		node: (id: string) =>
			container.querySelector<HTMLElement>(`#inner g[data-node-id="${id}"]`)!,
	};
}

it.each([
	"constructor",
	"toString",
	"__proto__",
])("hovers %s without inheriting absent metadata or a subflow", async (id) => {
	vi.useFakeTimers();
	const renderDot = vi.fn(async (_dot: string) =>
		svg.replaceAll("<title>p</title>", `<title>${id}</title>`),
	);
	const s = setup(renderDot);
	const graph = buildPreviewGraph(analyzeSnapshot(`a >> ${id}\n`), null);
	await s.preview.receive({
		...s.message,
		graph,
		descriptions: {},
		locations: {},
		subflows: {},
	});
	s.node(id).dispatchEvent(
		new MouseEvent("mousemove", {
			bubbles: true,
			clientX: 100,
			clientY: 80,
		}),
	);
	await vi.advanceTimersByTimeAsync(1);
	expect(renderDot).toHaveBeenCalledTimes(1);
	expect(s.container.querySelector("#tooltip svg g.node")).toBeNull();
	expect(s.node(id).dataset.subflow).toBeUndefined();
	expect(s.container.querySelector("#tooltip .tt-hint")).toBeNull();
	s.postMessage.mockClear();
	s.node(id).dispatchEvent(
		new MouseEvent("click", { bubbles: true, metaKey: true }),
	);
	expect(s.postMessage).not.toHaveBeenCalled();
	await s.preview.receive({
		...s.message,
		graph,
		descriptions: { [id]: [["label", "Authored metadata"]] },
		locations: { [id]: ["plan.pfdsl"] },
		subflows: { [id]: "subflow.pfdsl" },
	});
	s.node(id).dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
	await vi.advanceTimersByTimeAsync(1);
	expect(s.container.querySelector("#tooltip")!.textContent).toContain(
		"Authored metadata",
	);
	expect(s.node(id).dataset.subflow).toBe("subflow.pfdsl");
	s.node(id).dispatchEvent(
		new MouseEvent("click", { bubbles: true, metaKey: true }),
	);
	expect(s.postMessage).toHaveBeenCalledWith({
		type: "openFile",
		path: "subflow.pfdsl",
	});
});

it.each([
	{ width: 200, height: 100, scale: 1 },
	{ width: 736, height: 536, scale: 0.5 },
])("places a cue around the node at scale $scale without changing SVG paint", async (size) => {
	const styled = svg.replace(
		'<polygon points="0,0 40,0 40,30"/>',
		'<polygon fill="#ffccee" stroke="#663399" stroke-width="3" stroke-dasharray="5,2" points="0,0 40,0 40,30"/>',
	);
	const s = setup(
		vi.fn(async (_dot: string) => styled),
		size,
	);
	await s.preview.receive(s.message);
	const inner = s.container.querySelector<HTMLElement>("#inner")!;
	vi.spyOn(inner, "getBoundingClientRect").mockReturnValue(
		new DOMRect(100, 70, size.width * size.scale, size.height * size.scale),
	);
	vi.spyOn(s.node("a"), "getBoundingClientRect").mockReturnValue(
		new DOMRect(
			100 + 40 * size.scale,
			70 + 30 * size.scale,
			80 * size.scale,
			30 * size.scale,
		),
	);
	const original = s.node("a").innerHTML;
	await s.preview.receive({ type: "focus", nodeId: "a" });
	const ring = inner.querySelector<HTMLElement>(":scope > .pfdsl-focus-ring")!;
	expect(ring).not.toBeNull();
	expect(ring.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
	expect(ring.getAttribute("aria-hidden")).toBe("true");
	expect(window.getComputedStyle(ring).pointerEvents).toBe("none");
	expect(window.getComputedStyle(ring).position).toBe("absolute");
	expect(Number.parseFloat(ring.style.left)).toBeCloseTo(40 - 4 / size.scale);
	expect(Number.parseFloat(ring.style.top)).toBeCloseTo(30 - 4 / size.scale);
	expect(Number.parseFloat(ring.style.width)).toBeCloseTo(80 + 8 / size.scale);
	expect(Number.parseFloat(ring.style.height)).toBeCloseTo(30 + 8 / size.scale);
	expect(Number.parseFloat(ring.style.outlineWidth)).toBeCloseTo(
		2 / size.scale,
	);
	expect(s.node("a").innerHTML).toBe(original);
	expect(
		s.container.querySelector("#minimap-svg .pfdsl-focus-ring"),
	).toBeNull();
	const svgNode = inner.querySelector("svg")!;
	expect(svgNode.contains(ring)).toBe(false);
	s.container.querySelector<HTMLButtonElement>("#zoom-in")!.click();
	expect(ring.parentElement).toBe(inner);
	expect(Number.parseFloat(ring.style.outlineWidth)).toBeCloseTo(
		2 / (size.scale * 1.1),
	);
	expect(s.node("a").innerHTML).toBe(original);
	s.preview.dispose();
	expect(inner.querySelector(".pfdsl-focus-ring")).toBeNull();
});

it("keeps the cue gap at four screen pixels when changing the fitted zoom", async () => {
	vi.useFakeTimers();
	const s = setup(
		vi.fn(async (_dot: string) => svg),
		{
			width: 368 / 0.062,
			height: 268 / 0.062,
		},
	);
	await s.preview.receive(s.message);
	const inner = s.container.querySelector<HTMLElement>("#inner")!;
	const currentScale = () =>
		Number(inner.style.transform.match(/scale\(([^)]+)\)/)![1]);
	vi.spyOn(inner, "getBoundingClientRect").mockImplementation(
		() => new DOMRect(100, 70, 200 * currentScale(), 100 * currentScale()),
	);
	vi.spyOn(s.node("a"), "getBoundingClientRect").mockImplementation(
		() =>
			new DOMRect(
				100 + 40 * currentScale(),
				70 + 30 * currentScale(),
				80 * currentScale(),
				30 * currentScale(),
			),
	);
	await s.preview.receive({ type: "focus", nodeId: "a" });
	const ring = inner.querySelector<HTMLElement>(".pfdsl-focus-ring")!;
	const checkBox = () => {
		const scale = currentScale();
		expect(Number.parseFloat(ring.style.left) * scale).toBeCloseTo(
			40 * scale - 4,
		);
		expect(Number.parseFloat(ring.style.top) * scale).toBeCloseTo(
			30 * scale - 4,
		);
		expect(Number.parseFloat(ring.style.width) * scale).toBeCloseTo(
			80 * scale + 8,
		);
		expect(Number.parseFloat(ring.style.height) * scale).toBeCloseTo(
			30 * scale + 8,
		);
		expect(Number.parseFloat(ring.style.outlineWidth) * scale).toBeCloseTo(2);
	};
	expect(currentScale()).toBeCloseTo(0.062);
	checkBox();
	await vi.advanceTimersByTimeAsync(1000);
	for (const id of ["actual-size", "zoom-in", "zoom-out", "fit-graph"]) {
		s.container.querySelector<HTMLButtonElement>(`#${id}`)!.click();
		checkBox();
	}
	await vi.advanceTimersByTimeAsync(500);
	expect(inner.querySelector(".pfdsl-focus-ring")).toBeNull();
});

it("replaces the cue and clears its timer; a redraw never starts another cue", async () => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	await s.preview.receive({ type: "focus", nodeId: "a" });
	expect(s.node("a").classList.contains("pfdsl-focus-cue")).toBe(true);
	const oldRing = s.container.querySelector(".pfdsl-focus-ring")!;
	expect(oldRing).not.toBeNull();
	await vi.advanceTimersByTimeAsync(1000);
	await s.preview.receive({ type: "focus", nodeId: "p" });
	expect(s.node("a").classList.contains("pfdsl-focus-cue")).toBe(false);
	expect(s.node("p").classList.contains("pfdsl-focus-cue")).toBe(true);
	expect(oldRing.isConnected).toBe(false);
	expect(s.container.querySelectorAll(".pfdsl-focus-ring")).toHaveLength(1);
	await vi.advanceTimersByTimeAsync(600);
	expect(s.node("p").classList.contains("pfdsl-focus-cue")).toBe(true);
	expect(s.container.querySelector(".pfdsl-focus-ring")).not.toBeNull();
	await s.preview.receive(s.message);
	expect(s.container.querySelector(".pfdsl-focus-cue")).toBeNull();
	expect(s.container.querySelector(".pfdsl-focus-ring")).toBeNull();
	await s.preview.receive({ type: "focus", nodeId: "a" });
	await vi.advanceTimersByTimeAsync(1499);
	expect(s.container.querySelector(".pfdsl-focus-ring")).not.toBeNull();
	await vi.advanceTimersByTimeAsync(1);
	expect(s.container.querySelector(".pfdsl-focus-cue")).toBeNull();
	expect(s.container.querySelector(".pfdsl-focus-ring")).toBeNull();
});

it("keeps a right-clicked node stationary until its context menu opens", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	const inner = s.container.querySelector<HTMLElement>("#inner")!;
	const transform = inner.style.transform;
	const press = new MouseEvent("mousedown", {
		bubbles: true,
		cancelable: true,
		button: 2,
	});
	s.node("a").dispatchEvent(press);
	expect(press.defaultPrevented).toBe(true);
	expect(inner.style.transform).toBe(transform);
	s.node("a").dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		false,
	);
	expect(s.container.querySelector("#node-actions-title")!.textContent).toBe(
		"Connections — a",
	);
});

it("keeps keyboard focus in the pan coordinate system after browser scrolling", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	s.root.scrollLeft = 80;
	s.root.scrollTop = 50;
	s.node("p").focus();
	expect([s.root.scrollLeft, s.root.scrollTop]).toEqual([0, 0]);
	expect(s.node("p").classList.contains("pfdsl-focus-cue")).toBe(true);
});

it("keeps manual pan when the same node regains focus, but reveals a different focused node", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").focus();
	s.root.dispatchEvent(
		new MouseEvent("mousedown", {
			bubbles: true,
			button: 0,
			clientX: 10,
			clientY: 20,
		}),
	);
	window.dispatchEvent(
		new MouseEvent("mousemove", { buttons: 1, clientX: 60, clientY: 50 }),
	);
	window.dispatchEvent(new MouseEvent("mouseup"));
	const inner = s.container.querySelector<HTMLElement>("#inner")!;
	const panned = inner.style.transform;
	s.container.querySelector<HTMLButtonElement>("#preview-help-toggle")!.focus();
	s.root.scrollLeft = 30;
	s.node("p").focus();
	expect(inner.style.transform).toBe(panned);
	expect(s.root.scrollLeft).toBe(0);
	s.node("a").focus();
	expect(inner.style.transform).not.toBe(panned);
});

it.each([
	false,
	true,
])("drops a removed action target after redraw (error recovery: %s)", async (recover) => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	if (recover) await s.preview.receive({ type: "error", message: "Broken" });
	await s.preview.receive({
		...s.message,
		editing: { source: "a\n", nodes: [s.message.editing.nodes[0]!] },
	});
	s.container.querySelector<HTMLButtonElement>("#node-actions-toggle")!.click();
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		false,
	);
	expect(s.container.querySelector("#node-actions-title")!.textContent).toBe(
		"Connections — a",
	);
});

it("retains the minimap SVG on focus and resize, but replaces it after rendering", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	const clone = s.container.querySelector("#minimap-svg svg")!;
	await s.preview.receive({ type: "focus", nodeId: "a" });
	window.dispatchEvent(new Event("resize"));
	expect(s.container.querySelector("#minimap-svg svg")).toBe(clone);
	await s.preview.receive(s.message);
	expect(s.container.querySelector("#minimap-svg svg")).not.toBe(clone);
});

it("recovers the Connections center after repeated errors without restoring selection, input or focus", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
	const input =
		s.container.querySelector<HTMLInputElement>(".connection-input") ??
		s.container.querySelector<HTMLInputElement>("#node-actions input")!;
	input.value = "unfinished";
	await s.preview.receive({ type: "clearFocus" });
	const editor = document.createElement("textarea");
	s.container.append(editor);
	editor.focus();
	s.postMessage.mockClear();
	await s.preview.receive({ type: "error", message: "Invalid YAML" });
	await s.preview.receive({ type: "clearFocus" });
	await s.preview.receive({ type: "error", message: "Still invalid" });
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
	await s.preview.receive(s.message);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		false,
	);
	expect(s.container.querySelector("#node-actions-title")!.textContent).toBe(
		"Connections — p",
	);
	expect(input.value).toBe("");
	expect(document.activeElement).toBe(editor);
	expect(s.preview.canCreateDefinition()).toBe(false);
	expect(s.postMessage).not.toHaveBeenCalled();
});

it.each([
	"close before",
	"escape during",
	"other node",
	"render hint",
	"removed",
])("does not recover an abandoned Connections center: %s", async (reason) => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
	if (reason === "close before")
		s.container
			.querySelector<HTMLButtonElement>("#node-actions-close")!
			.click();
	await s.preview.receive({ type: "error", message: "Invalid YAML" });
	if (reason === "escape during")
		s.container.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	if (reason === "other node")
		await s.preview.receive({ type: "focus", nodeId: "a" });
	if (reason === "render hint")
		await s.preview.receive({ ...s.message, focusNodeId: "a" });
	if (reason === "removed")
		await s.preview.receive({
			...s.message,
			editing: { source: "a\n", nodes: [s.message.editing.nodes[0]!] },
		});
	await s.preview.receive(s.message);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
});

it("only consumes recovery after the newest render succeeds, including hidden previews", async () => {
	let finish!: (value: string) => void;
	const s = setup(
		vi.fn((dot: string) =>
			dot === "pending"
				? new Promise<string>((resolve) => {
						finish = resolve;
					})
				: Promise.resolve(svg),
		),
	);
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
	await s.preview.receive({ type: "error", message: "Invalid YAML" });
	const old = s.preview.receive({
		...s.message,
		dot: "pending",
		editing: { source: "a\n", nodes: [s.message.editing.nodes[0]!] },
	});
	s.container.hidden = true;
	await s.preview.receive({ type: "error", message: "Invalid again" });
	finish(svg);
	await old;
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
	await s.preview.receive(s.message);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		false,
	);
	expect(s.container.querySelector("#node-actions-title")!.textContent).toBe(
		"Connections — p",
	);
});

it("forgets pending Connections edits on error so late replies cannot lock or repopulate recovery", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("a").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
	s.container.querySelector<HTMLButtonElement>("#create-definition")!.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	expect(request.type).toBe("createDefinition");
	await s.preview.receive({ type: "error", message: "Invalid YAML" });
	await s.preview.receive(s.message);
	expect(
		s.container.querySelector<HTMLButtonElement>("#create-definition")!
			.disabled,
	).toBe(false);
	await s.preview.receive({
		type: "editResult",
		request: request as never,
		ok: false,
		message: "Old failure",
	});
	expect(s.container.querySelector("#node-actions-error")!.textContent).toBe(
		"",
	);
});
