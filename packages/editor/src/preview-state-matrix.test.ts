// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeSnapshot } from "./document.js";
import type { MessageToWebview } from "./messages.js";
import { mountPreview, NODE_CLICK_DELAY_MS } from "./preview.js";
import { buildPreviewGraph } from "./preview-graph.js";

const states = ["A", "B", "C", "D", "E"] as const;
type State = (typeof states)[number];
type Expected = readonly [boolean, boolean, boolean, boolean, boolean];
type Harness = Awaited<ReturnType<typeof setup>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

// Fixed acceptance matrix in A/B/C/D/E order, independent of preview internals.
const operations: Array<{
	name: string;
	expected: Expected;
	variants?: string[];
	select?: string;
	check(s: Harness, expected: boolean, variant: string): void | Promise<void>;
}> = [
	{
		name: "diagnostic node mark",
		expected: [true, true, true, true, false],
		check(s, expected) {
			const mark = s.target().querySelector(".pfdsl-diagnostic-mark");
			expect(mark !== null).toBe(expected);
			if (expected)
				expect(mark?.getAttribute("data-severity")).toBe(
					["C", "D"].includes(s.state) ? "error" : "warning",
				);
		},
	},
	{
		name: "stale node aria label guides source navigation",
		expected: [false, false, true, true, false],
		check(s, expected) {
			const label = s.target().getAttribute("aria-label") ?? "";
			expect(label.includes("Double-click to go to source.")).toBe(expected);
			if (expected) expect(label).not.toContain("Connections");
		},
	},
	{
		name: "view buttons",
		expected: [true, true, true, true, false],
		check(s, expected) {
			for (const id of ["zoom-in", "zoom-out", "fit-graph", "actual-size"])
				expect(!s.button(id).disabled, id).toBe(expected);
		},
	},
	{
		name: "Focus selected node button",
		expected: [true, false, true, false, false],
		select: "a",
		async check(s, expected) {
			expect(!s.button("focus-selected-node").disabled).toBe(expected);
			if (s.state === "B" || s.state === "D") {
				await s.completeRender();
				expect(s.button("focus-selected-node").disabled).toBe(false);
				expect(s.target().classList.contains("pfdsl-focus-cue")).toBe(true);
			}
		},
	},
	{
		name: "Connections button",
		expected: [true, true, false, false, false],
		check(s, expected) {
			expect(!s.button("node-actions-toggle").disabled).toBe(expected);
			s.button("node-actions-toggle").click();
			expect(s.panelOpen()).toBe(s.state === "A");
		},
	},
	{
		name: "create definition capability",
		expected: [true, false, false, false, false],
		select: "u",
		check(s, expected) {
			expect(s.preview.canCreateDefinition()).toBe(expected);
		},
	},
	{
		name: "node click opens Connections",
		expected: [true, false, false, false, false],
		async check(s, expected) {
			s.target().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			s.target().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			await vi.advanceTimersByTimeAsync(NODE_CLICK_DELAY_MS);
			expect(s.panelOpen()).toBe(expected);
			if (!expected) expect(s.postMessage).not.toHaveBeenCalled();
		},
	},
	{
		name: "node keyboard or context menu opens Connections",
		expected: [true, false, false, false, false],
		variants: ["Enter", " ", "contextmenu"],
		check(s, expected, variant) {
			s.target().dispatchEvent(
				variant === "contextmenu"
					? new MouseEvent("contextmenu", { bubbles: true })
					: new KeyboardEvent("keydown", { key: variant, bubbles: true }),
			);
			expect(s.panelOpen()).toBe(expected);
			if (!expected) expect(s.postMessage).not.toHaveBeenCalled();
		},
	},
	{
		name: "node double-click sends only nodeClick",
		expected: [true, true, true, true, false],
		check(s, expected) {
			s.target().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
			expect(s.postMessage.mock.calls).toEqual(
				expected ? [[{ type: "nodeClick", nodeId: "a" }]] : [],
			);
		},
	},
	{
		name: "node double-click opens Connections",
		expected: [true, false, false, false, false],
		check(s, expected) {
			s.target().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
			expect(s.panelOpen()).toBe(expected);
		},
	},
	{
		name: "modified click opens location",
		expected: [true, false, false, false, false],
		variants: ["metaKey", "ctrlKey"],
		check(s, expected, variant) {
			s.target().dispatchEvent(
				new MouseEvent("click", { [variant]: true, bubbles: true }),
			);
			expect(s.postMessage.mock.calls).toEqual(
				expected ? [[{ type: "openLocation", nodeId: "a" }]] : [],
			);
		},
	},
	{
		name: "hover visibility",
		expected: [true, false, true, true, false],
		variants: ["pointer", "keyboard"],
		check(s, expected, variant) {
			s.hover(variant);
			expect(s.tooltip.style.display === "block").toBe(expected);
		},
	},
	{
		name: "hover starts with last valid diagram notice",
		expected: [false, false, true, true, false],
		variants: ["pointer", "keyboard"],
		check(s, expected, variant) {
			s.hover(variant);
			expect(
				s.tooltip.textContent!.startsWith("From the last valid diagram"),
			).toBe(expected);
		},
	},
	{
		name: "hover includes modified-click hint",
		expected: [true, false, false, false, false],
		variants: ["pointer", "keyboard"],
		check(s, expected, variant) {
			s.hover(variant);
			expect(s.tooltip.textContent!.includes("+Click to open")).toBe(expected);
		},
	},
	{
		name: "persistent stale notice",
		expected: [false, false, true, true, false],
		check(s, expected) {
			expect(s.container.querySelector(".stale-notice") !== null).toBe(
				expected,
			);
		},
	},
];

describe.each(states)("preview state %s", (state) => {
	for (const operation of operations) {
		it.each(
			operation.variants ?? ["default"],
		)(`${operation.name} (%s)`, async (variant) => {
			const s = await setup(state);
			if (operation.select)
				await s.preview.receive({ type: "focus", nodeId: operation.select });
			await operation.check(
				s,
				operation.expected[states.indexOf(state)]!,
				variant,
			);
			if (state === "E") {
				expect(s.container.querySelector("#inner g.node")).toBeNull();
				expect(s.postMessage).not.toHaveBeenCalled();
			}
		});
	}
});

async function setup(state: State) {
	vi.useFakeTimers();
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
	const source =
		"---\nartifact:\n  a: {label: A, location: a.md}\n---\na >> p -> b\nu >> p\n";
	const svg = `<svg width="200" height="100" viewBox="0 0 200 100">${["a", "b", "p", "u"].map((id) => `<g class="node"><title>${id}</title><text font-size="14">${id}</text></g>`).join("")}</svg>`;
	const renderDot = vi.fn(async (_dot: string) => svg);
	const postMessage = vi.fn();
	const preview = mountPreview(container, { postMessage, renderDot });
	const root = container.querySelector<HTMLElement>("#root")!;
	const inner = container.querySelector<HTMLElement>("#inner")!;
	Object.defineProperties(root, {
		clientWidth: { value: 400 },
		clientHeight: { value: 300 },
	});
	Object.defineProperties(inner, {
		offsetWidth: { value: 200 },
		offsetHeight: { value: 100 },
	});
	const render: Extract<MessageToWebview, { type: "render" }> = {
		type: "render",
		dot: "main",
		graph: buildPreviewGraph(analyzeSnapshot(source), null),
		locations: { a: ["a.md"] },
		nodeDiagnostics: {
			a: [{ severity: "warning", code: "W007", message: "Warning" }],
		},
		descriptions: {
			a: [
				["**", "A"],
				["location", "a.md"],
			],
		},
		editing: {
			source,
			nodes: [
				{ id: "a", kind: "artifact", defined: true },
				{ id: "b", kind: "artifact", defined: false },
				{ id: "u", kind: "artifact", defined: false },
				{ id: "p", kind: "process", defined: false },
			],
		},
	};
	const error: MessageToWebview = {
		type: "error",
		message: "V010: Cycle",
		nodeDiagnostics: {
			a: [{ severity: "error", code: "V010", message: "Cycle" }],
		},
	};
	let finish: ((svg: string) => void) | undefined;
	let pending: Promise<void> | undefined;
	cleanups.push(async () => {
		preview.dispose();
		finish?.(svg);
		await pending;
		container.remove();
	});
	if (state !== "E") await preview.receive(render);
	if (["C", "D", "E"].includes(state)) await preview.receive(error);
	if (state === "B" || state === "D") {
		renderDot.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		pending = preview.receive({ ...render, dot: "next" });
		expect(renderDot).toHaveBeenCalledTimes(2);
	}
	postMessage.mockClear();
	const target = () =>
		container.querySelector<HTMLElement>('#inner [data-node-id="a"]') ?? root;
	return {
		state,
		container,
		preview,
		postMessage,
		target,
		async completeRender() {
			finish?.(svg);
			await pending;
		},
		button: (id: string) =>
			container.querySelector<HTMLButtonElement>(`#${id}`)!,
		panelOpen: () =>
			!container.querySelector<HTMLElement>("#node-actions")!.hidden,
		tooltip: container.querySelector<HTMLElement>("#tooltip")!,
		hover(variant: string) {
			target().dispatchEvent(
				variant === "keyboard"
					? new FocusEvent("focusin", { bubbles: true })
					: new MouseEvent("mousemove", { bubbles: true }),
			);
		},
	};
}
