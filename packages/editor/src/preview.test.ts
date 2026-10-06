// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountPreview } from "./preview.js";

const svg = (id: string) =>
	`<svg width="100" height="100" viewBox="0 0 100 100"><g class="node"><title>${id}</title><text>${id}</text></g></svg>`;

describe("portable preview lifecycle", () => {
	it("keeps graph dragging from starting native SVG text selection", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const preview = mountPreview(container, {
			postMessage() {},
			renderDot: async () => svg("a"),
		});
		await preview.receive({ type: "render", dot: "a" });
		const down = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientX: 10,
			clientY: 20,
		});
		container.querySelector("g.node text")!.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(true);
		window.dispatchEvent(
			new MouseEvent("mousemove", { buttons: 1, clientX: 110, clientY: 70 }),
		);
		expect(
			container.querySelector<HTMLElement>("#inner")!.style.transform,
		).toBe("translate(100px, 50px) scale(1)");
		window.dispatchEvent(new MouseEvent("mouseup"));
		preview.dispose();
		container.remove();
	});
	it.each(
		["superseded", "hidden", "loading"].flatMap((state) =>
			[false, true].map((focus) => ({ state, focus })),
		),
	)("positions the first visible frame after $state render, initial focus=$focus", async ({
		state,
		focus,
	}) => {
		const frames: FrameRequestCallback[] = [];
		const raf = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback) => {
				frames.push(callback);
				return frames.length;
			});
		const container = document.createElement("div");
		document.body.append(container);
		let resolveFirst!: (value: string) => void;
		const preview = mountPreview(container, {
			postMessage() {},
			renderDot: async (dot) =>
				state === "loading" && dot === "first"
					? new Promise<string>((resolve) => {
							resolveFirst = resolve;
						})
					: svg("a"),
		});
		const root = container.querySelector("#root")!;
		const inner = container.querySelector<HTMLElement>("#inner")!;
		let visible = state !== "hidden";
		Object.defineProperties(root, {
			clientWidth: { get: () => (visible ? 400 : 0) },
			clientHeight: { get: () => (visible ? 300 : 0) },
		});
		Object.defineProperties(inner, {
			offsetWidth: { value: 100 },
			offsetHeight: { value: 100 },
		});
		try {
			const first = preview.receive({
				type: "render",
				dot: "first",
				...(focus ? { focusNodeId: "a" } : {}),
			});
			if (state !== "loading") await first;
			if (state === "hidden") {
				for (const callback of frames.splice(0)) callback(0);
				visible = true;
			}
			await preview.receive({ type: "render", dot: "second" });
			if (state === "loading") {
				resolveFirst(svg("a"));
				await first;
			}
			for (const callback of frames.splice(0)) callback(0);
			expect(inner.style.transform).toBe("translate(150px, 100px) scale(1)");
		} finally {
			preview.dispose();
			container.remove();
			raf.mockRestore();
		}
	});
	it.each([
		{ type: "clearFocus" } as const,
		{ type: "focus", nodeId: "missing" } as const,
	])("allows later $type to replace a pending initial focus", async (message) => {
		const frames: FrameRequestCallback[] = [];
		const raf = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback) => {
				frames.push(callback);
				return frames.length;
			});
		const container = document.createElement("div");
		document.body.append(container);
		const preview = mountPreview(container, {
			postMessage() {},
			renderDot: async () => svg("a"),
		});
		const root = container.querySelector("#root")!;
		const inner = container.querySelector<HTMLElement>("#inner")!;
		Object.defineProperties(root, {
			clientWidth: { value: 400 },
			clientHeight: { value: 300 },
		});
		Object.defineProperties(inner, {
			offsetWidth: { value: 100 },
			offsetHeight: { value: 100 },
		});
		try {
			await preview.receive({ type: "render", dot: "first", focusNodeId: "a" });
			await preview.receive(message);
			await preview.receive({ type: "render", dot: "second" });
			for (const callback of frames) callback(0);
			expect(inner.style.transform).toBe("translate(150px, 100px) scale(1)");
		} finally {
			preview.dispose();
			container.remove();
			raf.mockRestore();
		}
	});
	it("keeps previews separate and cancels old renders after an error or disposal", async () => {
		const a = document.createElement("div");
		const b = document.createElement("div");
		document.body.append(a, b);
		const sent: string[] = [];
		let resolve!: (value: string) => void;
		const first = mountPreview(a, {
			postMessage: (m) => sent.push(m.type),
			renderDot: () =>
				new Promise((r) => {
					resolve = r;
				}),
		});
		const second = mountPreview(b, {
			postMessage() {},
			renderDot: async () => svg("second"),
		});
		const pending = first.receive({ type: "render", dot: "old" });
		await second.receive({ type: "render", dot: "second" });
		await first.receive({ type: "error", message: "Invalid <source>" });
		resolve(svg("old"));
		await pending;
		expect(a.textContent).toContain("Invalid <source>");
		expect(a.querySelector("svg")).toBeNull();
		expect(b.querySelector("g.node")?.getAttribute("data-node-id")).toBe(
			"second",
		);
		expect(sent).toEqual(["ready"]);
		const disposed = first.receive({ type: "render", dot: "closed" });
		first.dispose();
		resolve(svg("closed"));
		await disposed;
		expect(a.querySelector("svg")).toBeNull();
		second.dispose();
	});
	it("routes node gestures through the supplied host and removes listeners on disposal", async () => {
		const root = document.createElement("div");
		document.body.append(root);
		const sent: string[] = [];
		const preview = mountPreview(root, {
			postMessage: (m) => sent.push(m.type),
			renderDot: async () => svg("a"),
		});
		await preview.receive({ type: "render", dot: "a" });
		const node = root.querySelector("g.node")!;
		node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		expect(sent).toEqual(["ready", "nodeClick"]);
		preview.dispose();
		node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		expect(sent).toHaveLength(2);
	});
});
