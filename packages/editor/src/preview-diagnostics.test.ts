// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { analyzeSnapshot, prepareDocument } from "./document.js";
import { mountPreview } from "./preview.js";
import { previewStyles } from "./preview-shell.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.restoreAllMocks();
});

function setup() {
	vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
	// Graphviz node coordinates, including a translated node, stay local to g.node.
	Object.defineProperty(SVGElement.prototype, "getBBox", {
		configurable: true,
		value: () => ({ x: -20, y: -10, width: 40, height: 20 }),
	});
	const container = document.createElement("div");
	document.body.append(container);
	const svg =
		'<svg width="200" height="100"><g class="node" transform="translate(50,50)"><title>a</title><polygon points="-20,-10 20,-10 20,10 -20,10"/><text>a</text></g><g class="node"><title>p</title></g><g class="cluster"><title>group</title></g></svg>';
	const renderDot = vi.fn(async () => svg);
	const preview = mountPreview(container, { postMessage() {}, renderDot });
	cleanups.push(() => {
		preview.dispose();
		container.remove();
		delete (SVGElement.prototype as Partial<SVGGraphicsElement>).getBBox;
	});
	const node = () =>
		container.querySelector<HTMLElement>('#inner [data-node-id="a"]')!;
	const marks = () =>
		container.querySelectorAll("#inner .pfdsl-diagnostic-mark");
	const tooltip = container.querySelector<HTMLElement>("#tooltip")!;
	return { container, preview, renderDot, svg, node, marks, tooltip };
}

it.each([
	["error", "circle", "!"],
	["warning", "polygon", "!"],
	["info", "circle", "i"],
] as const)("marks only matching nodes with maximum severity %s and an accessible count", async (severity, shape, symbol) => {
	const s = setup();
	await s.preview.receive({
		type: "render",
		dot: "graph",
		nodeDiagnostics: {
			a: [
				{ severity: "info", code: "I001", message: "Info" },
				{ severity, code: "X001", message: "Problem" },
			],
			missing: [{ severity: "error", code: "V010", message: "Absent" }],
			group: [{ severity: "error", code: "V025", message: "Cluster" }],
		},
	});
	expect(s.marks()).toHaveLength(1);
	const mark = s.marks()[0]!;
	expect(mark.getAttribute("data-severity")).toBe(severity);
	expect(mark.querySelector(shape)).not.toBeNull();
	expect(mark.querySelector("text")?.textContent).toBe(symbol);
	expect(mark.getAttribute("transform")).toBe("translate(20 -10)");
	expect(mark.getAttribute("pointer-events")).toBe("none");
	expect(s.node().getAttribute("aria-label")).toBe(
		`Node a. 2 problems, most severe: ${severity}. Click or press Enter for Connections.`,
	);
	expect(
		s.container
			.querySelector('#inner [data-node-id="p"]')
			?.getAttribute("aria-label"),
	).toBe("Node p. Click or press Enter for Connections.");
	// Descendant rules for Graphviz shapes must not restore pointer events on the mark.
	expect(previewStyles).toContain(
		".pfdsl-diagnostic-mark * { pointer-events: none;",
	);
});

it.each([
	{ order: ["error", "warning", "info"] as const },
	{ order: ["warning", "info", "error"] as const },
	{ order: ["info", "error", "warning"] as const },
])("chooses one error mark over warning and info in order $order", async ({
	order,
}) => {
	const s = setup();
	await s.preview.receive({
		type: "render",
		dot: "graph",
		nodeDiagnostics: {
			a: order.map((severity) => ({
				severity,
				code: "X001",
				message: severity,
			})),
		},
	});
	expect(s.marks()).toHaveLength(1);
	expect(s.marks()[0]!.getAttribute("data-severity")).toBe("error");
	expect(s.marks()[0]!.querySelector("circle")).not.toBeNull();
	expect(s.node().getAttribute("aria-label")).toBe(
		"Node a. 3 problems, most severe: error. Click or press Enter for Connections.",
	);
});

it("replaces and clears current diagnostic marks in both the old diagram and its minimap", async () => {
	const s = setup();
	const root = s.container.querySelector<HTMLElement>("#root")!;
	const inner = s.container.querySelector<HTMLElement>("#inner")!;
	Object.defineProperties(s.container, {
		clientWidth: { value: 400 },
		clientHeight: { value: 300 },
	});
	Object.defineProperties(root, {
		clientWidth: { value: 400 },
		clientHeight: { value: 300 },
	});
	Object.defineProperties(inner, {
		offsetWidth: { value: 200 },
		offsetHeight: { value: 100 },
	});
	const warning = analyzeSnapshot(
		"---\ntype: workflow\nartifact:\n  a: {status: done}\n---\na >> p -> b\n",
	);
	expect(
		warning.diagnostics.filter((d) => d.nodeIds?.includes("a")),
	).toMatchObject([{ severity: "warning", code: "W007", nodeIds: ["a"] }]);
	await s.preview.receive(prepareDocument(warning, null, () => null).message);
	const mainSvg = inner.querySelector("svg");
	const minimapSvg = s.container.querySelector("#minimap-svg svg");
	expect(mainSvg).not.toBeNull();
	expect(minimapSvg).not.toBeNull();
	for (const svg of [mainSvg!, minimapSvg!]) {
		expect(svg.querySelectorAll(".pfdsl-diagnostic-mark")).toHaveLength(1);
		expect(
			svg
				.querySelector('[data-node-id="a"] .pfdsl-diagnostic-mark')
				?.getAttribute("data-severity"),
		).toBe("warning");
	}
	const cycle = analyzeSnapshot("a >> p -> a\n");
	expect(cycle.diagnostics).toContainEqual(
		expect.objectContaining({
			severity: "error",
			code: "V010",
			nodeIds: expect.arrayContaining(["a", "p"]),
		}),
	);
	await s.preview.receive(prepareDocument(cycle, null, () => null).message);
	expect(inner.querySelector("svg")).toBe(mainSvg);
	expect(s.container.querySelector("#minimap-svg svg")).toBe(minimapSvg);
	for (const svg of [mainSvg!, minimapSvg!]) {
		expect(svg.querySelectorAll(".pfdsl-diagnostic-mark")).toHaveLength(2);
		expect(
			svg
				.querySelector('[data-node-id="a"] .pfdsl-diagnostic-mark')
				?.getAttribute("data-severity"),
		).toBe("error");
		expect(svg.querySelector('[data-severity="warning"]')).toBeNull();
	}
	const syntax = analyzeSnapshot("a >>");
	expect(syntax.diagnostics.some((d) => d.severity === "error")).toBe(true);
	expect(syntax.diagnostics.every((d) => !d.nodeIds?.length)).toBe(true);
	await s.preview.receive(prepareDocument(syntax, null, () => null).message);
	expect(inner.querySelector("svg")).toBe(mainSvg);
	expect(s.container.querySelector("#minimap-svg svg")).toBe(minimapSvg);
	for (const svg of [mainSvg!, minimapSvg!])
		expect(svg.querySelectorAll(".pfdsl-diagnostic-mark")).toHaveLength(0);
});

it.each([
	"pointer",
	"keyboard",
])("shows escaped diagnostic lines in %s hover and separates current source from stale metadata", async (gesture) => {
	const s = setup();
	const nodeDiagnostics = {
		a: [
			{
				severity: "error" as const,
				code: "V010",
				message: '<img src=x onerror="bad()"> & cycle',
			},
		],
	};
	await s.preview.receive({
		type: "render",
		dot: "graph",
		descriptions: { a: [["**", "Old metadata"]] },
		nodeDiagnostics: {
			a: [
				{ severity: "warning", code: "W007", message: "First warning" },
				{ severity: "info", code: "I001", message: "Then info" },
			],
		},
	});
	s.node().dispatchEvent(
		gesture === "pointer"
			? new MouseEvent("mousemove", { bubbles: true })
			: new FocusEvent("focusin", { bubbles: true }),
	);
	expect(s.tooltip.querySelector(".tt-diagnostics")?.textContent).toBe(
		"Diagnosticswarning W007: First warninginfo I001: Then info",
	);
	expect(
		[...s.tooltip.querySelectorAll(".tt-diagnostics > div")].map(
			(line) => line.textContent,
		),
	).toEqual(["warning W007: First warning", "info I001: Then info"]);
	await s.preview.receive({ type: "error", message: "Cycle", nodeDiagnostics });
	s.node().dispatchEvent(
		gesture === "pointer"
			? new MouseEvent("mousemove", { bubbles: true })
			: new FocusEvent("focusin", { bubbles: true }),
	);
	expect(s.tooltip.style.display).toBe("block");
	expect(s.tooltip.textContent).toBe(
		'From the last valid diagramOld metadataCurrent sourceerror V010: <img src=x onerror="bad()"> & cycle',
	);
	expect(s.tooltip.querySelector("img")).toBeNull();
	expect(s.tooltip.querySelector(".tt-diagnostics")?.textContent).toBe(
		'Current sourceerror V010: <img src=x onerror="bad()"> & cycle',
	);
	expect(s.node().getAttribute("aria-label")).toBe(
		"Node a. 1 error. Double-click to go to source.",
	);
});

it("replaces warning marks with current V010 on the old graph and then with the new render table", async () => {
	const s = setup();
	const prepare = (source: string) =>
		prepareDocument(analyzeSnapshot(source), null, () => null).message;
	await s.preview.receive(
		prepare(
			"---\ntype: workflow\nartifact:\n  a: {status: done}\n---\na >> p -> b\n",
		),
	);
	expect(s.node().querySelector('[data-severity="warning"]')).not.toBeNull();
	await s.preview.receive(prepare("a >> p -> a\nmissing >> q -> missing\n"));
	expect(s.marks()).toHaveLength(2);
	expect(s.node().querySelector('[data-severity="error"]')).not.toBeNull();
	expect(
		s.container.querySelector('#inner [data-severity="warning"]'),
	).toBeNull();
	await s.preview.receive({
		type: "render",
		dot: "new",
		nodeDiagnostics: {
			p: [{ severity: "info", code: "I001", message: "New" }],
		},
	});
	expect(s.marks()).toHaveLength(1);
	expect(s.node().querySelector(".pfdsl-diagnostic-mark")).toBeNull();
	expect(s.node().getAttribute("aria-label")).toBe(
		"Node a. Click or press Enter for Connections.",
	);
	await s.preview.receive({ type: "error", message: "Syntax" });
	expect(s.marks()).toHaveLength(0);
});

it("does not let a late render overwrite the error diagnostic table", async () => {
	const s = setup();
	await s.preview.receive({ type: "render", dot: "valid" });
	let finish!: (svg: string) => void;
	s.renderDot.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const pending = s.preview.receive({
		type: "render",
		dot: "late",
		nodeDiagnostics: {
			a: [{ severity: "warning", code: "W007", message: "Obsolete" }],
		},
	});
	await s.preview.receive({
		type: "error",
		message: "Cycle",
		nodeDiagnostics: {
			a: [{ severity: "error", code: "V010", message: "Current" }],
		},
	});
	finish(s.svg);
	await pending;
	expect(s.node().querySelector('[data-severity="error"]')).not.toBeNull();
	expect(s.node().getAttribute("aria-label")).toContain("1 error");
});
