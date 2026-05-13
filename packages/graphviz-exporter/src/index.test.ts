import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, normalizeDocument, parse } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import { exportDot } from "./index.js";

const samplesDir = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../docs/samples",
);

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
			  newrank=true;

			  "design" [shape=ellipse, label="design"];
			  "req" [shape=box, label="req", penwidth="2"];
			  "spec" [shape=box, label="spec", penwidth="2"];

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
		expect(dot).toMatch(/"req" \[shape=box, label="req", penwidth="2"\]/);
		expect(dot).toMatch(/"design" \[shape=ellipse, label="design"\]/);
		expect(dot).toMatch(/"spec" \[shape=box, label="spec", penwidth="2"\]/);
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

	it("uses frontmatter label for node label", () => {
		const src = `---
artifact:
  req: { label: 要求仕様書 }
process:
  design: { label: 設計 }
---
req >> design -> spec
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		// "要求仕様書" = 5 CJK = 10 units → 10*0.1+0.3 = 1.30
		expect(dot).toContain(
			'"req" [shape=box, label="req\\n要求仕様書", width=1.30, penwidth="2"]',
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
			/"スキャン" \[shape=box, label="スキャン", width=1\.10, penwidth="2"\]/,
		);
		// 「アンケートのtsv」: artifact (box), 6 CJK + 3 ASCII → 15 units → max(0.75, 1.5+0.3) = 1.80
		expect(dot).toMatch(
			/"アンケートのtsv" \[shape=box, label="アンケートのtsv", width=1\.80, penwidth="2"\]/,
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

	it("escapes newline in labels", () => {
		const src = `---
artifact:
  spec: { label: "line1\\nline2" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		// label embeds id + "\n" + label; the literal newline must be re-escaped.
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
			/"spec" \[shape=box, label="spec", xlabel="done", fillcolor="lightgray", style="filled", penwidth="2"\]/,
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
		expect(dot).toMatch(
			/"spec" \[shape=box, label="spec", xlabel="external", color="blue", penwidth="2"\]/,
		);
	});

	it("xlabel joins multiple tags with comma separator", () => {
		const src = `---
artifact:
  spec: { tags: [external, sensitive] }
tagStyles:
  external: { color: blue }
  sensitive: { style: dashed }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(
			/"spec" \[shape=box, label="spec", xlabel="external, sensitive"/,
		);
	});

	it("xlabel joins status and tags with comma separator", () => {
		const src = `---
artifact:
  spec: { status: done, tags: [external] }
statusStyles:
  done: { fillcolor: lightgray, style: filled }
tagStyles:
  external: { color: blue }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(
			/"spec" \[shape=box, label="spec", xlabel="done, external"/,
		);
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
		expect(dot).toMatch(
			/"spec" \[shape=box, label="spec", xlabel="missing", penwidth="2"\]/,
		);
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

describe("group / subgraph cluster", () => {
	it("nodes with a declared group are emitted inside subgraph cluster_<id>", () => {
		const src = `---
group:
  g1:
    label: "Data Ingestion"
    color: lightblue
artifact:
  raw_data:
    group: g1
  processed:
    group: g1
process:
  ingest:
    group: g1
---
raw_data >> ingest -> processed
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain("subgraph cluster_g1 {");
		expect(dot).toContain('label="Data Ingestion";');
		expect(dot).toContain('color="lightblue";');
		expect(dot).toContain('"raw_data"');
		expect(dot).toContain('"processed"');
		expect(dot).toContain('"ingest"');
		expect(dot).toContain('"raw_data" -> "ingest";');
		expect(dot).toContain('"ingest" -> "processed";');
	});

	it("full-DOT snapshot with group", () => {
		const src = `---
group:
  g1:
    label: "Data Ingestion"
    color: lightblue
artifact:
  raw_data:
    group: g1
  processed:
    group: g1
process:
  ingest:
    group: g1
---
raw_data >> ingest -> processed
`;
		const { graph, frontmatter } = buildFromSource(src);
		expect(exportDot(graph, frontmatter)).toMatchInlineSnapshot(`
			"digraph PFDSL {
			  rankdir=LR;
			  newrank=true;

			  subgraph cluster_g1 {
			    label="Data Ingestion";
			    color="lightblue";
			    "ingest" [shape=ellipse, label="ingest"];
			    "processed" [shape=box, label="processed", penwidth="2"];
			    "raw_data" [shape=box, label="raw_data", penwidth="2"];
			  }

			  "raw_data" -> "ingest";
			  "ingest" -> "processed";
			}
			"
		`);
	});

	it("ungrouped nodes are emitted flat alongside grouped subgraphs", () => {
		const src = `---
group:
  g1: {}
artifact:
  a:
    group: g1
  b: {}
process:
  P: {}
---
a >> P -> b
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain("subgraph cluster_g1 {");
		const subgraphStart = dot.indexOf("subgraph cluster_g1 {");
		const subgraphEnd = dot.indexOf("}", subgraphStart);
		expect(dot.slice(subgraphStart, subgraphEnd)).toContain('"a"');
		expect(dot.slice(subgraphEnd)).toContain('"b"');
		expect(dot.slice(subgraphEnd)).toContain('"P"');
	});

	it("group with no label or color emits bare subgraph block", () => {
		const src = `---
group:
  g1: {}
artifact:
  a:
    group: g1
process:
  P: {}
---
a >> P -> b
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain("subgraph cluster_g1 {");
		// subgraph block has no cluster-level label or color lines
		const clusterBlock = dot.slice(
			dot.indexOf("subgraph cluster_g1 {"),
			dot.indexOf("  }") + 3,
		);
		expect(clusterBlock).not.toMatch(/^\s+label=/m);
		expect(clusterBlock).not.toMatch(/^\s+color=/m);
	});

	it("node with group referencing undeclared group id is rendered flat without error", () => {
		const src = `---
artifact:
  a:
    group: nonexistent
process:
  P: {}
---
a >> P -> b
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).not.toContain("subgraph");
		expect(dot).toContain('"a" [shape=box');
	});

	it("multiple groups emit cluster blocks sorted by group id", () => {
		const src = `---
group:
  g2:
    label: "Second"
  g1:
    label: "First"
artifact:
  a:
    group: g1
  b:
    group: g2
process:
  P: {}
---
a >> P -> b
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		const posG1 = dot.indexOf("cluster_g1");
		const posG2 = dot.indexOf("cluster_g2");
		expect(posG1).toBeLessThan(posG2);
	});
});

describe("boundary artifact penwidth", () => {
	it("source artifact (no incoming primary edges) gets penwidth=2", () => {
		const { graph, frontmatter } = buildFromSource("req >> design -> spec\n");
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(/"req" \[shape=box, label="req", penwidth="2"\]/);
	});

	it("sink artifact (no outgoing primary edges) gets penwidth=2", () => {
		const { graph, frontmatter } = buildFromSource("req >> design -> spec\n");
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(/"spec" \[shape=box, label="spec", penwidth="2"\]/);
	});

	it("middle artifact (has both in and out) does not get penwidth", () => {
		const { graph, frontmatter } = buildFromSource(
			"req >> P1 -> mid\nmid >> P2 -> out\n",
		);
		const dot = exportDot(graph, frontmatter);
		expect(dot).not.toMatch(/"mid" \[.*penwidth/);
	});

	it("process nodes do not get boundary penwidth", () => {
		const { graph, frontmatter } = buildFromSource("req >> design -> spec\n");
		const dot = exportDot(graph, frontmatter);
		expect(dot).not.toMatch(/"design" \[.*penwidth/);
	});

	it("user-specified penwidth in tagStyles is not overridden", () => {
		const src = `---
artifact:
  req: { tags: [critical] }
tagStyles:
  critical: { penwidth: "5" }
---
req >> design -> spec
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		// req: source, user-specified penwidth="5" → boundary logic skips it
		expect(dot).toMatch(
			/"req" \[shape=box, label="req", xlabel="critical", penwidth="5"\]/,
		);
		expect(dot).not.toMatch(/"req" \[.*penwidth="2"/);
	});

	it("sink artifact with feedback edge out still gets penwidth=2", () => {
		const { graph, frontmatter } = buildFromSource(
			"req >> design -> spec\nspec >>? design\n",
		);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(/"spec" \[shape=box, label="spec", penwidth="2"\]/);
	});
});

describe("fixture files", () => {
	const files = readdirSync(samplesDir)
		.filter((f) => f.endsWith(".pfdsl"))
		.sort();
	for (const f of files) {
		it(f.replace(".pfdsl", ""), () => {
			const src = readFileSync(resolve(samplesDir, f), "utf-8");
			const expected = readFileSync(
				resolve(samplesDir, f.replace(".pfdsl", ".dot")),
				"utf-8",
			);
			const { graph, frontmatter } = buildFromSource(src);
			expect(exportDot(graph, frontmatter)).toBe(expected);
		});
	}
});
