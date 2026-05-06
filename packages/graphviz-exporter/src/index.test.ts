import { buildGraph, normalizeDocument, parse } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import { exportDot } from "./index.js";

function buildFromSource(src: string) {
	const { document, frontmatter } = parse(src);
	const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
	const graph = buildGraph(edges, nodeKinds);
	return { graph, frontmatter };
}

describe("exportDot", () => {
	it("emits a digraph with default rankdir LR", () => {
		const { graph, frontmatter } = buildFromSource("req >> design -> spec\n");
		const dot = exportDot(graph, frontmatter);
		expect(dot.startsWith("digraph PFDSL {")).toBe(true);
		expect(dot).toContain("rankdir=LR;");
		expect(dot.endsWith("}\n")).toBe(true);
	});

	it("full-DOT snapshot for minimal chain (locks node order, edge order, attribute set)", () => {
		const { graph, frontmatter } = buildFromSource(
			"req >> design -> spec\nspec >>? design\n",
		);
		expect(exportDot(graph, frontmatter)).toMatchInlineSnapshot(`
      "digraph PFDSL {
        rankdir=LR;

        "design" [shape=ellipse, label="design"];
        "req" [shape=box, label="req"];
        "spec" [shape=box, label="spec"];

        "req" -> "design";
        "design" -> "spec";
        "spec" -> "design" [style=dashed, color="#888888", constraint=false];
      }
      "
    `);
	});

	it("uses box for artifacts and ellipse for processes", () => {
		const { graph, frontmatter } = buildFromSource("req >> design -> spec\n");
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(/"req" \[shape=box, label="req"\]/);
		expect(dot).toMatch(/"design" \[shape=ellipse, label="design"\]/);
		expect(dot).toMatch(/"spec" \[shape=box, label="spec"\]/);
	});

	it("emits primary edges as solid arrows", () => {
		const { graph, frontmatter } = buildFromSource("req >> design -> spec\n");
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain('"req" -> "design";');
		expect(dot).toContain('"design" -> "spec";');
	});

	it("emits feedback edges as dashed with color", () => {
		const src = "req >> design -> spec\nspec >>? design\n";
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(
			/"spec" -> "design" \[style=dashed, color="#888888", constraint=false\];/,
		);
	});

	it("uses frontmatter title for node label", () => {
		const src = `---
artifact:
  req: { title: 要求仕様書 }
process:
  design: { title: 設計 }
---
req >> design -> spec
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		// "要求仕様書" = 5 CJK = 10 units → 10*0.1+0.3 = 1.30
		expect(dot).toContain(
			'"req" [shape=box, label="req\\n要求仕様書", width=1.30]',
		);
		// widest line is "design" = 6 ASCII = 6 units → 6*0.1+0.3 = 0.90
		expect(dot).toContain(
			'"design" [shape=ellipse, label="design\\n設計", width=0.90]',
		);
	});

	it("honors layout.direction in frontmatter", () => {
		const src = `---
layout: { direction: TB }
---
req >> design -> spec
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain("rankdir=TB;");
	});

	it("options override frontmatter direction", () => {
		const src = `---
layout: { direction: TB }
---
req >> design -> spec
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter, { rankdir: "BT" });
		expect(dot).toContain("rankdir=BT;");
	});

	it("emits graph label from frontmatter title", () => {
		const src = `---
title: 開発フロー
---
req >> design -> spec
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain('label="開発フロー"');
		expect(dot).toContain('labelloc="t";');
	});

	it("sets minimum width for nodes with CJK labels to compensate wasm font metrics", () => {
		const { graph, frontmatter } = buildFromSource(
			"スキャン >> OCR -> アンケートのtsv\n",
		);
		const dot = exportDot(graph, frontmatter);
		// 「スキャン」: artifact (box), 4 CJK → 8 units → max(0.75, 0.8+0.3) = 1.10
		expect(dot).toMatch(
			/"スキャン" \[shape=box, label="スキャン", width=1\.10\]/,
		);
		// 「アンケートのtsv」: artifact (box), 6 CJK + 3 ASCII → 15 units → max(0.75, 1.5+0.3) = 1.80
		expect(dot).toMatch(
			/"アンケートのtsv" \[shape=box, label="アンケートのtsv", width=1\.80\]/,
		);
		// 「OCR」: process (ellipse), ASCII only → no width attr
		expect(dot).toMatch(/"OCR" \[shape=ellipse, label="OCR"\]/);
	});

	it("escapes quotes and backslashes in IDs and labels", () => {
		const { graph, frontmatter } = buildFromSource('"a\\"b" >> P -> X\n');
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain('"a\\"b"');
	});

	it("escapes backslash in IDs", () => {
		const { graph, frontmatter } = buildFromSource('"a\\\\b" >> P -> X\n');
		const dot = exportDot(graph, frontmatter);
		// Source ID value is `a\b`; DOT must double the backslash → `"a\\b"`.
		expect(dot).toContain('"a\\\\b"');
	});

	it("escapes newline in title labels", () => {
		const src = `---
artifact:
  spec: { title: "line1\\nline2" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		// label embeds id + "\n" + title; the title's literal newline must be re-escaped.
		expect(dot).toContain('label="spec\\nline1\\nline2"');
	});

	it("applies statusStyles to artifact with status", () => {
		const src = `---
artifact:
  spec: { status: done }
statusStyles:
  done: { fillcolor: lightgray, style: filled }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(
			/"spec" \[shape=box, label="spec", fillcolor="lightgray", style="filled"\]/,
		);
	});

	it("applies tagStyles to artifact with tags", () => {
		const src = `---
artifact:
  spec: { tags: [external] }
tagStyles:
  external: { color: blue }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(/"spec" \[shape=box, label="spec", color="blue"\]/);
	});

	it("first tag in array wins on conflicting attribute", () => {
		const src = `---
artifact:
  spec: { tags: [a, b] }
tagStyles:
  a: { color: red }
  b: { color: blue }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain('color="red"');
		expect(dot).not.toContain('color="blue"');
	});

	it("status overrides tag on conflicting attribute", () => {
		const src = `---
artifact:
  spec: { status: done, tags: [external] }
statusStyles:
  done: { color: gray }
tagStyles:
  external: { color: blue }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain('color="gray"');
		expect(dot).not.toContain('color="blue"');
	});

	it("non-conflicting tag and status attributes both applied", () => {
		const src = `---
artifact:
  spec: { status: done, tags: [external] }
statusStyles:
  done: { fillcolor: lightgray, style: filled }
tagStyles:
  external: { color: blue, penwidth: "3" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain('fillcolor="lightgray"');
		expect(dot).toContain('style="filled"');
		expect(dot).toContain('color="blue"');
		expect(dot).toContain('penwidth="3"');
	});

	it("undefined tagStyles entries are ignored without error", () => {
		const src = `---
artifact:
  spec: { tags: [missing] }
tagStyles:
  other: { color: blue }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(/"spec" \[shape=box, label="spec"\]/);
	});

	it("does not apply status/tags to process nodes", () => {
		const src = `---
process:
  P: {}
artifact:
  spec: { status: done }
statusStyles:
  done: { fillcolor: lightgray }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(/"P" \[shape=ellipse, label="P"\]/);
	});
});
