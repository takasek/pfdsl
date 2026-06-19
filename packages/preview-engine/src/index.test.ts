import { analyze, buildGraph, normalizeDocument, parse } from "@pfdsl/core";
import { exportDiffDot } from "@pfdsl/graphviz-exporter";
import { describe, expect, it } from "vitest";
import { renderDiff, renderDotToSvg, renderGraph } from "./index.js";

function buildFromSource(src: string) {
	const { document, frontmatter } = parse(src);
	const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
	const graph = buildGraph(edges, nodeKinds);
	return { graph, frontmatter };
}

describe("preview-engine", () => {
	it("renderGraph format=dot returns DOT", async () => {
		const { graph, frontmatter } = buildFromSource("req >> design -> spec\n");
		const out = await renderGraph(graph, frontmatter, { format: "dot" });
		expect(out.startsWith("digraph PFDSL {")).toBe(true);
	});

	it("renderGraph default returns SVG", async () => {
		const { graph, frontmatter } = buildFromSource("req >> design -> spec\n");
		const svg = await renderGraph(graph, frontmatter);
		expect(svg).toContain("<svg");
		expect(svg).toContain("</svg>");
	});

	it("renderDotToSvg renders raw DOT", async () => {
		const svg = await renderDotToSvg("digraph G { a -> b }");
		expect(svg).toContain("<svg");
	});
});

describe("renderDiff", () => {
	it("format=dot returns same string as exportDiffDot", async () => {
		const a = analyze("req >> design -> spec\n");
		const b = analyze("req >> design -> spec\nnewnode >> design\n");
		const expected = exportDiffDot(
			a.graph,
			a.frontmatter,
			b.graph,
			b.frontmatter,
		);
		const result = await renderDiff(
			a.graph,
			a.frontmatter,
			b.graph,
			b.frontmatter,
			{ format: "dot" },
		);
		expect(result).toBe(expected);
		expect(result.startsWith("digraph PFDSL {")).toBe(true);
	});

	it("format=svg resolves to a string containing <svg", async () => {
		const a = analyze("req >> design -> spec\n");
		const b = analyze("req >> design -> spec\nnewnode >> design\n");
		const svg = await renderDiff(
			a.graph,
			a.frontmatter,
			b.graph,
			b.frontmatter,
			{ format: "svg" },
		);
		expect(svg).toContain("<svg");
	});
});
