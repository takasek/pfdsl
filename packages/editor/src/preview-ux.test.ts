// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { mountPreview } from "./preview.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.restoreAllMocks();
});

function setup(width = 1600, height = 800) {
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	const container = document.createElement("div");
	document.body.append(container);
	let visible = true;
	const preview = mountPreview(container, {
		postMessage() {},
		renderDot: async (dot) => {
			if (dot === "reject") throw new Error("Graphviz <failure>\n".repeat(30));
			return `<svg width="${width}" height="${height}"><g class="node"><title>${dot}</title></g></svg>`;
		},
	});
	const root = container.querySelector<HTMLElement>("#root")!;
	const inner = container.querySelector<HTMLElement>("#inner")!;
	Object.defineProperties(root, {
		clientWidth: { get: () => (visible ? 400 : 0) },
		clientHeight: { get: () => (visible ? 300 : 0) },
	});
	Object.defineProperties(inner, {
		offsetWidth: { value: width },
		offsetHeight: { value: height },
	});
	cleanups.push(() => {
		preview.dispose();
		container.remove();
	});
	return {
		container,
		preview,
		root,
		inner,
		show: () => {
			visible = true;
		},
		hide: () => {
			visible = false;
		},
		flush: () => {
			for (const frame of frames.splice(0)) frame(0);
		},
		click: (id: string) =>
			container.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
	};
}

it("fits a large first graph even when opening supplied a cursor focus hint", async () => {
	const s = setup();
	await s.preview.receive({ type: "render", dot: "a", focusNodeId: "a" });
	s.flush();
	expect(s.inner.style.transform).toBe("translate(16px, 58px) scale(0.23)");
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("23%");
});

it("offers Fit and 100%, preserving manual view through redraw and error recovery", async () => {
	const s = setup();
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	s.click("actual-size");
	expect(s.inner.style.transform).toBe("translate(-600px, -250px) scale(1)");
	s.click("zoom-in");
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("110%");
	s.root.dispatchEvent(
		new MouseEvent("mousedown", {
			bubbles: true,
			button: 0,
			clientX: 30,
			clientY: 30,
		}),
	);
	window.dispatchEvent(
		new MouseEvent("mousemove", { buttons: 1, clientX: 70, clientY: 50 }),
	);
	window.dispatchEvent(new MouseEvent("mouseup"));
	const manual = s.inner.style.transform;
	await s.preview.receive({ type: "focus", nodeId: "a" });
	s.click("fit-graph");
	s.click("actual-size");
	// Pan after explicit focus; a text edit must not reapply the old focus.
	s.root.dispatchEvent(
		new MouseEvent("mousedown", { button: 0, clientX: 0, clientY: 0 }),
	);
	window.dispatchEvent(
		new MouseEvent("mousemove", { buttons: 1, clientX: 80, clientY: 60 }),
	);
	window.dispatchEvent(new MouseEvent("mouseup"));
	const editedView = s.inner.style.transform;
	expect(manual).not.toBe(editedView);
	await s.preview.receive({ type: "render", dot: "b" });
	s.flush();
	expect(s.inner.style.transform).toBe(editedView);
	await s.preview.receive({
		type: "error",
		message: "P007: missing expression",
	});
	await s.preview.receive({ type: "render", dot: "c" });
	s.flush();
	expect(s.inner.style.transform).toBe(editedView);
	s.click("fit-graph");
	expect(s.inner.style.transform).toBe("translate(16px, 58px) scale(0.23)");
});

it.each([
	"parse",
	"renderer",
])("shows %s errors outside transformed graph and clears stale minimap", async (kind) => {
	const s = setup();
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	s.click("zoom-in");
	const view = s.inner.style.transform;
	const message = `P007: Invalid <source> ${"x".repeat(1000)}`;
	if (kind === "parse") await s.preview.receive({ type: "error", message });
	else await s.preview.receive({ type: "render", dot: "reject" });
	const error = s.container.querySelector<HTMLElement>("#preview-error")!;
	expect(error.hidden).toBe(false);
	expect(error.closest("#inner")).toBeNull();
	expect(error.textContent).toBe(
		kind === "parse" ? message : "Graphviz <failure>\n".repeat(30),
	);
	expect(error.querySelector("source")).toBeNull();
	expect(s.inner.children).toHaveLength(0);
	expect(s.container.querySelector("#minimap-svg")!.children).toHaveLength(0);
	expect(
		s.container.querySelector<HTMLElement>("#minimap")!.style.display,
	).toBe("none");
	expect(
		s.container.querySelector<HTMLButtonElement>("#zoom-in")!.disabled,
	).toBe(true);
	const wheel = new WheelEvent("wheel", { deltaY: -1, cancelable: true });
	error.dispatchEvent(wheel);
	expect(wheel.defaultPrevented).toBe(false);
	await s.preview.receive({ type: "render", dot: "new" });
	s.flush();
	expect(error.hidden).toBe(true);
	expect(s.inner.style.transform).toBe(view);
	expect(
		s.container
			.querySelector("#minimap-svg [data-node-id]")!
			.getAttribute("data-node-id"),
	).toBe("new");
});

it("fits when a hidden preview becomes visible without another render, then keeps its view on resize", async () => {
	let resized!: ResizeObserverCallback;
	const disconnect = vi.fn();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resized = callback;
			}
			observe() {}
			disconnect = disconnect;
		},
	);
	cleanups.push(() => vi.unstubAllGlobals());
	const s = setup();
	s.hide();
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	s.show();
	resized([], {} as ResizeObserver);
	expect(s.inner.style.transform).toBe("translate(16px, 58px) scale(0.23)");
	s.click("actual-size");
	const view = s.inner.style.transform;
	resized([], {} as ResizeObserver);
	expect(s.inner.style.transform).toBe(view);
	s.preview.dispose();
	expect(disconnect).toHaveBeenCalled();
});

it("fits a graph larger than the wheel zoom floor without cropping", async () => {
	const s = setup(40000, 1000);
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	expect(s.inner.style.transform).toContain("scale(0.0092)");
});

it("offers related-file gestures only for a host that can open them", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const postMessage = vi.fn();
	const preview = mountPreview(container, {
		postMessage,
		canOpenRelatedFiles: false,
		renderDot: async () => '<svg><g class="node"><title>a</title></g></svg>',
	});
	cleanups.push(() => {
		preview.dispose();
		container.remove();
	});
	await preview.receive({
		type: "render",
		dot: "a",
		subflows: { a: "child.pfdsl" },
	});
	expect(container.querySelector("#preview-help")!.textContent).not.toContain(
		"Ctrl/⌘+Click",
	);
	const node = container.querySelector("#inner g.node")!;
	node.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
	expect(container.querySelector<HTMLElement>("#tooltip")!.style.display).toBe(
		"none",
	);
	node.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
	expect(postMessage.mock.calls).toEqual([[{ type: "ready" }]]);
});
