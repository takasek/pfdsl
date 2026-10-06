// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { analyzeSnapshot } from "./document.js";
import { buildPreviewGraph } from "./node-operations.js";
import { mountPreview } from "./preview.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
const svg =
	'<svg width="200" height="100"><g class="node"><title>a</title><polygon points="0,0 40,0 40,30"/><text>A</text></g><g class="node"><title>p</title><text>P</text></g></svg>';
function setup(renderDot = vi.fn(async (_dot: string) => svg)) {
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
	const root = container.querySelector<HTMLElement>("#root")!;
	Object.defineProperties(root, {
		clientWidth: { value: 400 },
		clientHeight: { value: 300 },
	});
	Object.defineProperties(container.querySelector("#inner")!, {
		offsetWidth: { value: 200 },
		offsetHeight: { value: 100 },
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

it("shows a real local graph for undefined nodes and keeps it clickable across the hover gap", async () => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	s.node("a").dispatchEvent(
		new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 80 }),
	);
	await vi.advanceTimersByTimeAsync(1);
	const tooltip = s.container.querySelector<HTMLElement>("#tooltip")!;
	expect(tooltip.querySelector("svg g.node")).not.toBeNull();
	s.root.dispatchEvent(new MouseEvent("mouseleave"));
	tooltip.dispatchEvent(new MouseEvent("mouseenter"));
	await vi.advanceTimersByTimeAsync(250);
	expect(tooltip.style.display).toBe("block");
	tooltip
		.querySelector<HTMLElement>('g[data-node-id="p"]')!
		.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	expect(s.node("p").classList.contains("pfdsl-focus-cue")).toBe(true);
	expect(s.postMessage).not.toHaveBeenCalledWith({
		type: "nodeClick",
		nodeId: "p",
	});
});

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
	expect(renderDot).toHaveBeenCalledTimes(2);
	expect(s.container.querySelector("#tooltip svg g.node")).not.toBeNull();
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

it("replaces the cue and clears its timer; a redraw never starts another cue", async () => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	await s.preview.receive({ type: "focus", nodeId: "a" });
	expect(s.node("a").classList.contains("pfdsl-focus-cue")).toBe(true);
	await s.preview.receive({ type: "focus", nodeId: "p" });
	expect(s.node("a").classList.contains("pfdsl-focus-cue")).toBe(false);
	expect(s.node("p").classList.contains("pfdsl-focus-cue")).toBe(true);
	await s.preview.receive(s.message);
	expect(s.container.querySelector(".pfdsl-focus-cue")).toBeNull();
	await s.preview.receive({ type: "focus", nodeId: "a" });
	await vi.advanceTimersByTimeAsync(1800);
	expect(s.container.querySelector(".pfdsl-focus-cue")).toBeNull();
});

it("opens the shared node panel from context/keyboard and emits source-bound creation/connection requests", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("a").dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
	const panel = s.container.querySelector<HTMLElement>("#node-actions")!;
	expect(panel.hidden).toBe(false);
	s.container.querySelector<HTMLButtonElement>("#create-definition")!.click();
	expect(s.postMessage).toHaveBeenCalledWith({
		type: "createDefinition",
		nodeId: "a",
		source: s.message.editing.source,
	});
	s.node("p").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	expect(
		s.container.querySelector<HTMLButtonElement>("#create-definition")!.hidden,
	).toBe(true);
	const input =
		s.container.querySelector<HTMLInputElement>("#connector-target")!;
	input.value = "new_result";
	s.container.querySelector<HTMLSelectElement>("#connector-kind")!.value = "->";
	s.container
		.querySelector<HTMLFormElement>("#connector-form")!
		.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	expect(s.postMessage).toHaveBeenCalledWith({
		type: "addConnector",
		nodeId: "p",
		source: s.message.editing.source,
		connector: "->",
		otherId: "new_result",
	});
	await s.preview.receive({
		...s.message,
		editing: { ...s.message.editing, source: "changed" },
	});
	expect(panel.hidden).toBe(true);
});

it("does not accept stale local graph completion after target change, redraw or dispose", async () => {
	let resolve!: (value: string) => void;
	const renderer = vi.fn((dot: string) =>
		dot === "main"
			? Promise.resolve(svg)
			: new Promise<string>((r) => {
					resolve = r;
				}),
	);
	const s = setup(renderer);
	await s.preview.receive(s.message);
	s.node("a").dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
	await s.preview.receive({ type: "error", message: "Broken" });
	resolve(svg);
	await Promise.resolve();
	await Promise.resolve();
	expect(
		s.container.querySelector<HTMLElement>("#tooltip")!.style.display,
	).toBe("none");
	expect(s.container.querySelector("#tooltip svg")).toBeNull();
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
		"artifact: a",
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

it("returns connection submission to the preview toolbar across redraw", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	s.container.querySelector<HTMLInputElement>("#connector-target")!.value =
		"extra";
	s.container
		.querySelector<HTMLButtonElement>("#connector-form button[type=submit]")!
		.click();
	await s.preview.receive(s.message);
	expect(document.activeElement).toBe(
		s.container.querySelector("#node-actions-toggle"),
	);
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
		"artifact: a",
	);
});

it("uses an unquoted placeholder in connection choices", async () => {
	const s = setup();
	await s.preview.receive(s.message);
	s.node("p").dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	expect(
		[...s.container.querySelectorAll("#connector-kind option")].map(
			(o) => o.textContent,
		),
	).toEqual(["… >> p", "… >>? p", "p -> …"]);
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

it("reuses neighborhood rendering within a revision and invalidates it on redraw", async () => {
	vi.useFakeTimers();
	const s = setup();
	await s.preview.receive(s.message);
	for (const id of ["a", "p", "a"]) {
		s.node(id).dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
		await vi.advanceTimersByTimeAsync(1);
	}
	expect(s.renderDot).toHaveBeenCalledTimes(3);
	await s.preview.receive(s.message);
	s.node("a").dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
	await vi.advanceTimersByTimeAsync(1);
	expect(s.renderDot).toHaveBeenCalledTimes(5);
});

it("shares in-flight neighborhood renders and ignores completion after redraw", async () => {
	vi.useFakeTimers();
	const resolveLocals: Array<(value: string) => void> = [];
	const renderDot = vi.fn(async (dot: string) =>
		dot === "main"
			? svg
			: new Promise<string>((resolve) => {
					resolveLocals.push(resolve);
				}),
	);
	const s = setup(renderDot);
	await s.preview.receive(s.message);
	for (const id of ["a", "p", "a"]) {
		s.node(id).dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
		await vi.advanceTimersByTimeAsync(1);
	}
	expect(renderDot).toHaveBeenCalledTimes(3);
	await s.preview.receive(s.message);
	for (const resolve of resolveLocals) resolve(svg);
	await vi.advanceTimersByTimeAsync(1);
	expect(
		s.container.querySelector("#tooltip")!.getAttribute("style"),
	).toContain("display: none");
});

it("retries a failed neighborhood render instead of caching the rejection", async () => {
	vi.useFakeTimers();
	const renderDot = vi
		.fn(async (_dot: string) => svg)
		.mockImplementationOnce(async () => svg)
		.mockRejectedValueOnce(new Error("layout failed"));
	const s = setup(renderDot);
	await s.preview.receive(s.message);
	for (const id of ["a", "p", "a"]) {
		s.node(id).dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
		await vi.advanceTimersByTimeAsync(1);
	}
	expect(renderDot).toHaveBeenCalledTimes(4);
	expect(s.container.querySelector("#tooltip svg")).not.toBeNull();
});
