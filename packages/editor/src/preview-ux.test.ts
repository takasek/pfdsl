// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { mountPreview } from "./preview.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.restoreAllMocks();
});

function setup(width = 1600, height = 800, onStateChange = () => {}) {
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	const container = document.createElement("div");
	document.body.append(container);
	let visible = true;
	let rootWidth = 400;
	let rootHeight = 300;
	let hostWidth = 400;
	let hostHeight = 360;
	let graphWidth = width;
	let graphHeight = height;
	const preview = mountPreview(container, {
		postMessage() {},
		onStateChange,
		renderDot: async (dot) => {
			if (dot === "reject") throw new Error("Graphviz <failure>\n".repeat(30));
			return `<svg width="${graphWidth}" height="${graphHeight}" viewBox="0 0 ${graphWidth} ${graphHeight}"><g class="node"><title>${dot}</title><text font-size="14">${dot}</text></g></svg>`;
		},
	});
	const root = container.querySelector<HTMLElement>("#root")!;
	const inner = container.querySelector<HTMLElement>("#inner")!;
	Object.defineProperties(container, {
		clientWidth: { get: () => (visible ? hostWidth : 0) },
		clientHeight: { get: () => (visible ? hostHeight : 0) },
	});
	Object.defineProperties(root, {
		clientWidth: { get: () => (visible ? rootWidth : 0) },
		clientHeight: { get: () => (visible ? rootHeight : 0) },
	});
	vi.spyOn(root, "getBoundingClientRect").mockImplementation(
		() => new DOMRect(0, 0, visible ? rootWidth : 0, visible ? rootHeight : 0),
	);
	Object.defineProperties(inner, {
		offsetWidth: { get: () => graphWidth },
		offsetHeight: { get: () => graphHeight },
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
		/** A panel inside the preview takes or returns graph area; the host keeps its size. */
		resizeRoot: (nextWidth: number, nextHeight = rootHeight) => {
			rootWidth = nextWidth;
			rootHeight = nextHeight;
		},
		/** The host (window or split) changes size, and the graph area with it. */
		resizeHost: (nextWidth: number, nextHeight = rootHeight) => {
			hostWidth += nextWidth - rootWidth;
			hostHeight += nextHeight - rootHeight;
			rootWidth = nextWidth;
			rootHeight = nextHeight;
		},
		resizeGraph: (nextWidth: number, nextHeight: number) => {
			graphWidth = nextWidth;
			graphHeight = nextHeight;
		},
		/** Only the host changes, as when it resizes while the graph area is hidden. */
		setHost: (nextWidth: number, nextHeight: number) => {
			hostWidth = nextWidth;
			hostHeight = nextHeight;
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

it("raises a fitted unreadable selection to the same view as Focus selected node", async () => {
	const s = setup();
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	const node = s.inner.querySelector<HTMLElement>("g.node")!;
	vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
		new DOMRect(170, 120, 23, 11.5),
	);
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("23%");
	await s.preview.receive({ type: "focus", nodeId: "a" });
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("100%");
	expect(node.classList.contains("pfdsl-focus-cue")).toBe(true);

	const manual = setup();
	await manual.preview.receive({ type: "render", dot: "a" });
	manual.flush();
	manual.root.dispatchEvent(
		new WheelEvent("wheel", {
			deltaY: -1,
			clientX: 100,
			clientY: 100,
			cancelable: true,
		}),
	);
	const manualView = manual.inner.style.transform;
	const manualNode = manual.inner.querySelector<HTMLElement>("g.node")!;
	vi.spyOn(manual.inner, "getBoundingClientRect").mockReturnValue(
		new DOMRect(-100, -80, 404, 202),
	);
	vi.spyOn(manualNode, "getBoundingClientRect").mockReturnValue(
		new DOMRect(40, 50, 10, 8),
	);
	await manual.preview.receive({ type: "focus", nodeId: "a" });
	expect(manual.container.querySelector("#zoom-level")!.textContent).toBe(
		"25.3%",
	);
	expect(manual.inner.style.transform).not.toBe(manualView);
	expect(manualNode.classList.contains("pfdsl-focus-cue")).toBe(true);
});

it("keeps a readable graph stationary while it remains fully visible", async () => {
	const s = setup(200, 100);
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	const node = s.inner.querySelector<HTMLElement>("g.node")!;
	vi.spyOn(s.inner, "getBoundingClientRect").mockReturnValue(
		new DOMRect(100, 100, 200, 100),
	);
	vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
		new DOMRect(140, 130, 40, 20),
	);
	const fittedView = s.inner.style.transform;
	await s.preview.receive({ type: "focus", nodeId: "a" });
	expect(s.inner.style.transform).toBe(fittedView);
	expect(node.classList.contains("pfdsl-focus-cue")).toBe(true);
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

it("commits the main graph and minimap together while animation frames are paused", async () => {
	const s = setup();
	await s.preview.receive({ type: "render", dot: "old" });
	s.flush();
	await s.preview.receive({ type: "render", dot: "new" });
	expect(
		s.inner.querySelector("[data-node-id]")?.getAttribute("data-node-id"),
	).toBe("new");
	expect(
		s.container
			.querySelector("#minimap-svg [data-node-id]")
			?.getAttribute("data-node-id"),
	).toBe("new");
	s.flush();
	expect(
		s.container
			.querySelector("#minimap-svg [data-node-id]")
			?.getAttribute("data-node-id"),
	).toBe("new");
});

it("does not retain a prior minimap when a new graph commits in a hidden tab", async () => {
	const s = setup();
	await s.preview.receive({ type: "render", dot: "old" });
	s.flush();
	s.hide();
	await s.preview.receive({ type: "render", dot: "new" });
	expect(
		s.container.querySelector("#minimap-svg [data-node-id='old']"),
	).toBeNull();
	s.show();
	window.dispatchEvent(new Event("resize"));
	expect(
		s.container
			.querySelector("#minimap-svg [data-node-id]")
			?.getAttribute("data-node-id"),
	).toBe("new");
});

it.each([
	"parse",
	"renderer",
])("publishes disabled diagram capability on %s failure and restores it on recovery", async (kind) => {
	const observed: boolean[] = [];
	const s = setup(1600, 800, () =>
		observed.push(
			!s.container.querySelector<HTMLButtonElement>("#node-actions-toggle")!
				.disabled,
		),
	);
	const valid = {
		type: "render" as const,
		dot: "a",
		editing: {
			source: "a >> p\n",
			nodes: [
				{ id: "a", kind: "artifact" as const, defined: false },
				{ id: "p", kind: "process" as const, defined: false },
			],
		},
	};
	await s.preview.receive(valid);
	expect(observed.at(-1)).toBe(true);
	observed.length = 0;
	await s.preview.receive(
		kind === "parse"
			? { type: "error", message: "P007: Invalid source" }
			: { ...valid, dot: "reject" },
	);
	expect(observed).toEqual([false]);
	await s.preview.receive(valid);
	expect(observed.at(-1)).toBe(true);
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

it("refits only Fit views on host resize and keeps Fit through panels and redraws", async () => {
	let resized!: ResizeObserverCallback;
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resized = callback;
			}
			observe() {}
			disconnect() {}
		},
	);
	cleanups.push(() => vi.unstubAllGlobals());
	const s = setup();
	// The observer reports the mounted host size before the first graph.
	resized([], {} as ResizeObserver);
	const editing = {
		source: "a\n",
		nodes: [{ id: "a", kind: "artifact" as const, defined: false }],
	};
	await s.preview.receive({ type: "render", dot: "a", editing });
	s.flush();
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("23%");
	s.resizeRoot(400, 200);
	resized([], {} as ResizeObserver);
	expect(
		s.container.querySelector("#zoom-level")!.textContent,
		"a panel taking graph area is not a host resize",
	).toBe("23%");
	s.resizeHost(800, 600);
	resized([], {} as ResizeObserver);
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("48%");
	s.resizeGraph(800, 400);
	await s.preview.receive({ type: "render", dot: "a", editing });
	s.flush();
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("48%");
	s.resizeHost(900, 600);
	window.dispatchEvent(new Event("resize"));
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("100%");
	s.resizeGraph(2000, 500);
	await s.preview.receive({ type: "render", dot: "a", editing });
	s.flush();
	s.click("fit-graph");
	const node = s.inner.querySelector<HTMLElement>("g.node")!;
	vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
		new DOMRect(100, 100, 40, 20),
	);
	const manualGestures = [
		() =>
			s.root.dispatchEvent(
				new WheelEvent("wheel", { deltaY: -1, cancelable: true }),
			),
		() => s.click("zoom-in"),
		() => {
			s.root.dispatchEvent(
				new MouseEvent("mousedown", { button: 0, clientX: 10, clientY: 10 }),
			);
			window.dispatchEvent(
				new MouseEvent("mousemove", {
					buttons: 1,
					clientX: 30,
					clientY: 30,
				}),
			);
			window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
		},
		() => {
			const minimap = s.container.querySelector<HTMLElement>("#minimap")!;
			minimap.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					clientX: 20,
					clientY: 20,
				}),
			);
			window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
		},
		() => {
			const minimap = s.container.querySelector<HTMLElement>("#minimap")!;
			minimap.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					clientX: 20,
					clientY: 20,
				}),
			);
			window.dispatchEvent(
				new MouseEvent("mousemove", {
					buttons: 1,
					clientX: 30,
					clientY: 30,
				}),
			);
			window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
		},
		() => s.click("actual-size"),
		() => {
			s.root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
			s.flush();
		},
		() => {
			node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
			expect(
				s.container.querySelector<HTMLButtonElement>("#focus-selected-node")!
					.disabled,
			).toBe(false);
			s.click("focus-selected-node");
		},
	];
	for (const [index, applyManualGesture] of manualGestures.entries()) {
		if (index > 0) s.click("fit-graph");
		const fitView = s.inner.style.transform;
		applyManualGesture();
		const manualView = s.inner.style.transform;
		expect(
			manualView,
			`manual gesture ${index} should change the view`,
		).not.toBe(fitView);
		s.resizeHost(s.root.clientWidth + 100, 600);
		resized([], {} as ResizeObserver);
		expect(
			s.inner.style.transform,
			`manual gesture ${index} should clear Fit`,
		).toBe(manualView);
	}
});

it("fits a Fit view again after a host resize made while an error was shown", async () => {
	let resized!: ResizeObserverCallback;
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resized = callback;
			}
			observe() {}
			disconnect() {}
		},
	);
	cleanups.push(() => vi.unstubAllGlobals());
	const s = setup();
	s.resizeHost(800, 600);
	resized([], {} as ResizeObserver);
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("48%");
	await s.preview.receive({ type: "error", message: "P007: Invalid source" });
	// The error hides the graph area, so the host resize cannot fit it yet.
	s.resizeRoot(0, 0);
	s.setHost(400, 360);
	resized([], {} as ResizeObserver);
	s.resizeRoot(400, 300);
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("23%");
});

it("refits a Fit view only for host resizes across every short sequence of view events", async () => {
	type Step =
		| "host"
		| "panel"
		| "error"
		| "recover"
		| "zoom"
		| "fit"
		| "hide"
		| "show"
		| "redraw";
	const steps: Step[] = [
		"host",
		"panel",
		"error",
		"recover",
		"zoom",
		"fit",
		"hide",
		"show",
		"redraw",
	];
	const sequences: Step[][] = [[]];
	for (let length = 0; length < 3; length++)
		for (const sequence of sequences.splice(0))
			for (const step of steps) sequences.push(sequence, [...sequence, step]);
	const unique = [...new Map(sequences.map((q) => [q.join(), q])).values()];
	let graph = { width: 1600, height: 800 };
	const fitScale = (width: number, height: number) =>
		Math.min(1, (width - 32) / graph.width, (height - 32) / graph.height);
	const scaleOf = (transform: string) =>
		Number(/scale\(([^)]+)\)/.exec(transform)?.[1]);
	let resized!: ResizeObserverCallback;
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resized = callback;
			}
			observe() {}
			disconnect() {}
		},
	);
	cleanups.push(() => vi.unstubAllGlobals());
	for (const sequence of unique) {
		graph = { width: 1600, height: 800 };
		const s = setup(graph.width, graph.height);
		resized([], {} as ResizeObserver);
		await s.preview.receive({ type: "render", dot: "a" });
		s.flush();
		// The model: what the graph area is, and whether the view is still Fit.
		let area = { width: 400, height: 300 };
		let panel = false;
		let error = false;
		let hidden = false;
		let fit = true;
		let hostChangedWhileFit = false;
		let expected = s.inner.style.transform;
		for (const step of sequence) {
			const label = `${sequence.join(" > ")}: ${step}`;
			if (step === "hide" || step === "show") {
				if (hidden === (step === "hide")) continue;
				hidden = step === "hide";
				if (hidden) s.hide();
				else s.show();
				resized([], {} as ResizeObserver);
			} else if (hidden && step !== "host") {
				continue;
			} else if (step === "redraw") {
				// An edit changes the graph's size; it must not refit by itself.
				if (error) continue;
				graph =
					graph.width === 1600
						? { width: 1200, height: 900 }
						: { width: 1600, height: 800 };
				s.resizeGraph(graph.width, graph.height);
				await s.preview.receive({ type: "render", dot: "a" });
				s.flush();
			} else if (step === "host") {
				area = { width: area.width === 400 ? 800 : 400, height: area.height };
				if (error) {
					s.setHost(area.width, area.height + 60);
					resized([], {} as ResizeObserver);
				} else {
					s.resizeHost(area.width, area.height - (panel ? 60 : 0));
					resized([], {} as ResizeObserver);
				}
				if (fit) hostChangedWhileFit = true;
			} else if (step === "panel") {
				if (error) continue;
				panel = !panel;
				s.resizeRoot(area.width, area.height - (panel ? 60 : 0));
				resized([], {} as ResizeObserver);
			} else if (step === "error") {
				if (error) continue;
				error = true;
				await s.preview.receive({
					type: "error",
					message: "P007: Invalid source",
				});
				s.resizeRoot(0, 0);
				resized([], {} as ResizeObserver);
			} else if (step === "recover") {
				if (!error) continue;
				error = false;
				s.resizeRoot(area.width, area.height - (panel ? 60 : 0));
				await s.preview.receive({ type: "render", dot: "a" });
				s.flush();
			} else if (step === "zoom") {
				if (error) continue;
				s.click("zoom-in");
				fit = false;
				hostChangedWhileFit = false;
				expected = s.inner.style.transform;
			} else {
				if (error) continue;
				s.click("fit-graph");
				fit = true;
				hostChangedWhileFit = false;
				expected = s.inner.style.transform;
				expect(scaleOf(expected), label).toBeCloseTo(
					fitScale(area.width, area.height - (panel ? 60 : 0)),
				);
			}
			if (error || hidden) continue;
			const actual = s.inner.style.transform;
			if (fit && hostChangedWhileFit) {
				expect(scaleOf(actual), label).toBeCloseTo(
					fitScale(area.width, area.height - (panel ? 60 : 0)),
				);
				expected = actual;
				hostChangedWhileFit = false;
			}
			expect(actual, label).toBe(expected);
		}
		s.preview.dispose();
	}
});

it("keeps Fit after a press that does not move the graph", async () => {
	let resized!: ResizeObserverCallback;
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resized = callback;
			}
			observe() {}
			disconnect() {}
		},
	);
	cleanups.push(() => vi.unstubAllGlobals());
	const s = setup();
	resized([], {} as ResizeObserver);
	await s.preview.receive({ type: "render", dot: "a" });
	s.flush();
	s.root.dispatchEvent(
		new MouseEvent("mousedown", { button: 0, clientX: 10, clientY: 10 }),
	);
	window.dispatchEvent(
		new MouseEvent("mousemove", { buttons: 1, clientX: 10, clientY: 10 }),
	);
	window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
	s.resizeHost(800, 600);
	resized([], {} as ResizeObserver);
	expect(s.container.querySelector("#zoom-level")!.textContent).toBe("48%");
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
		"block",
	);
	expect(container.querySelector("#tooltip .tt-hint")).toBeNull();
	node.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
	expect(postMessage.mock.calls).toEqual([[{ type: "ready" }]]);
});
