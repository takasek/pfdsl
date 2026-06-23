import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, buildGraph, normalizeDocument, parse } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import { exportDiffDot, exportDot } from "./index.js";

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

	it("applies tag style to artifact with tags", () => {
		const src = `---
artifact:
  spec: { tags: [external] }
tag:
  external: { style: { color: blue } }
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
tag:
  external: { style: { color: blue } }
  sensitive: { style: { style: dashed } }
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
tag:
  external: { style: { color: blue } }
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
tag:
  a: { style: { color: red } }
  b: { style: { color: blue } }
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
tag:
  external: { style: { color: blue } }
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
tag:
  external: { style: { color: blue, penwidth: "3" } }
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

	it("undefined tag entries are ignored without error", () => {
		const src = `---
artifact:
  spec: { tags: [missing] }
tag:
  other: { style: { color: blue } }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(
			/"spec" \[shape=box, label="spec", xlabel="missing", penwidth="2"\]/,
		);
	});

	it("does not inherit artifact status onto process nodes", () => {
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

	it("applies tag style to process with tags", () => {
		const src = `---
process:
  P: { tags: [shared] }
artifact:
  spec: {}
tag:
  shared: { style: { color: green } }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(
			/"P" \[shape=ellipse, label="P", xlabel="shared", color="green"\]/,
		);
	});

	it("xlabel joins multiple process tags with comma separator", () => {
		const src = `---
process:
  P: { tags: [reusable, audited] }
artifact:
  spec: {}
tag:
  reusable: { style: { color: green } }
  audited: { style: { penwidth: "3" } }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toMatch(
			/"P" \[shape=ellipse, label="P", xlabel="reusable, audited"/,
		);
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
			    style="filled";
			    fillcolor="lightblue";
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

	it("renders hex color code in group cluster", () => {
		const src = `---
group:
  g1:
    color: "#ff0000"
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
		expect(dot).toContain('color="#ff0000";');
	});

	it("emits style=filled and fillcolor matching color when group has color", () => {
		const src = `---
group:
  g1:
    color: lightblue
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
		const clusterBlock = dot.slice(
			dot.indexOf("subgraph cluster_g1 {"),
			dot.indexOf("  }") + 3,
		);
		expect(clusterBlock).toContain('style="filled";');
		expect(clusterBlock).toContain('fillcolor="lightblue";');
	});

	it("darkens hex stroke color while keeping original as fillcolor", () => {
		const src = `---
group:
  g1:
    color: "#ff0000"
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
		const clusterBlock = dot.slice(
			dot.indexOf("subgraph cluster_g1 {"),
			dot.indexOf("  }") + 3,
		);
		// stroke: #ff0000 * 0.7 → #b30000
		expect(clusterBlock).toContain('color="#b30000";');
		expect(clusterBlock).toContain('fillcolor="#ff0000";');
	});

	it("keeps same named color for stroke and fill when hex parsing is not applicable", () => {
		const src = `---
group:
  g1:
    color: lightblue
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
		const clusterBlock = dot.slice(
			dot.indexOf("subgraph cluster_g1 {"),
			dot.indexOf("  }") + 3,
		);
		expect(clusterBlock).toContain('color="lightblue";');
		expect(clusterBlock).toContain('fillcolor="lightblue";');
	});

	it("does not emit style or fillcolor when group has no color", () => {
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
		const clusterBlock = dot.slice(
			dot.indexOf("subgraph cluster_g1 {"),
			dot.indexOf("  }") + 3,
		);
		expect(clusterBlock).not.toMatch(/^\s+style=/m);
		expect(clusterBlock).not.toMatch(/^\s+fillcolor=/m);
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

	it("user-specified penwidth in tag style is not overridden", () => {
		const src = `---
artifact:
  req: { tags: [critical] }
tag:
  critical: { style: { penwidth: "5" } }
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

describe("label wrapping", () => {
	it("does not wrap label when layout.maxWidth is not set", () => {
		const longLabel =
			"ソースコード、SpreadSheet、JIRA、Confluenceなど複数のドキュメントソース";
		const src = `---
artifact:
  spec: { label: "${longLabel}" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		const m = dot.match(/"spec" \[.*?label="([^"]+)"/);
		expect(m).not.toBeNull();
		// Only one \n separator (id vs label), no wrapping
		expect(m![1]!.split("\\n").length).toBe(2);
	});

	it("wraps long label when layout.maxWidth is set", () => {
		const src = `---
layout:
  maxWidth: 80
artifact:
  spec: { label: "ソースコード、SpreadSheet、JIRA、Confluenceなど複数のドキュメントソース" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		const m = dot.match(/"spec" \[.*?label="([^"]+)"/);
		expect(m).not.toBeNull();
		// More than one \n → wrapping occurred
		expect(m![1]!.split("\\n").length).toBeGreaterThan(2);
	});

	it("prefers breaking at punctuation (、ends the line)", () => {
		const src = `---
layout:
  maxWidth: 80
artifact:
  spec: { label: "ソースコード、JIRA、Confluenceなどのドキュメント" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		const m = dot.match(/"spec" \[.*?label="([^"]+)"/);
		expect(m).not.toBeNull();
		const lines = m![1]!.split("\\n").slice(1); // drop id line
		// At least one wrapped line should end with 、
		const endsWithPunct = lines.some((l) => l.endsWith("、"));
		expect(endsWithPunct).toBe(true);
	});

	it("tooltip preserves original unwrapped label when wrapping occurs", () => {
		const originalLabel = "ソースコード、SpreadSheet、JIRA、Confluence";
		const src = `---
layout:
  maxWidth: 50
artifact:
  spec: { label: "${originalLabel}" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain(`tooltip="${originalLabel}"`);
	});

	it("tooltip includes description when present", () => {
		const src = `---
artifact:
  spec: { label: "要求仕様書", description: "詳細な説明文" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain('tooltip="要求仕様書\\n\\n詳細な説明文"');
	});

	it("tooltip includes description for process nodes too", () => {
		const src = `---
process:
  P: { label: "処理", description: "詳細" }
---
spec >> P -> X
`;
		const { graph, frontmatter } = buildFromSource(src);
		const dot = exportDot(graph, frontmatter);
		expect(dot).toContain('tooltip="処理\\n\\n詳細"');
	});

	describe("location field", () => {
		it("adds href when location is a URL", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", location: "https://example.com/spec" }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).toContain('href="https://example.com/spec"');
		});

		it("does not add href when location is a file path", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", location: "docs/spec.md" }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).not.toContain("href=");
		});

		it("does not crash when location is a non-string YAML value", () => {
			const fm = {
				artifact: { spec: { label: "仕様書", location: 42 } },
			} as unknown as Parameters<typeof exportDot>[1];
			const { graph } = buildFromSource("spec >> P -> X");
			expect(() => exportDot(graph, fm)).not.toThrow();
		});

		it("includes location in tooltip after description", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", description: "詳細", location: "docs/spec.md" }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).toContain("docs/spec.md");
			expect(dot).toContain("詳細");
		});

		it("includes location in tooltip when no description", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", location: "docs/spec.md" }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).toContain("docs/spec.md");
		});

		it("shows comma-joined locations in tooltip when location is an array", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", location: ["a.ts", "b.ts"] }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).toContain("a.ts, b.ts");
		});

		it("does not add href when location is an array with a URL", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", location: ["https://example.com/a", "https://example.com/b"] }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).not.toContain("href=");
		});

		it("adds href when location is a single-element URL array", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", location: ["https://example.com/spec"] }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).toContain('href="https://example.com/spec"');
		});
	});

	describe("criteria field", () => {
		it("includes criteria in tooltip", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", status: "done", criteria: "TL承認済み" }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).toContain("TL承認済み");
		});

		it("includes criteria and description both in tooltip", () => {
			const src = `---
artifact:
  spec: { label: "仕様書", description: "詳細", criteria: "TL承認済み" }
---
spec >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).toContain("詳細");
			expect(dot).toContain("TL承認済み");
		});
	});

	describe("revises field", () => {
		it("includes revises target in tooltip", () => {
			const src = `---
artifact:
  v2: { label: "仕様書v2", revises: "v1" }
  v1: { label: "仕様書v1" }
---
v1 >> P -> v2
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).toContain("revises: v1");
		});

		it("no revises annotation when revises is absent", () => {
			const src = `---
artifact:
  v2: { label: "仕様書v2" }
---
v2 >> P -> X
`;
			const { graph, frontmatter } = buildFromSource(src);
			const dot = exportDot(graph, frontmatter);
			expect(dot).not.toContain("revises:");
		});
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

describe("exportDiffDot", () => {
	it("added node is styled with green fillcolor", () => {
		const a = analyze("req >> design -> spec\n");
		const b = analyze("req >> design -> spec\nnewnode >> design\n");
		const dot = exportDiffDot(a.graph, a.frontmatter, b.graph, b.frontmatter);
		expect(dot).toContain('"newnode"');
		expect(dot).toContain('fillcolor="#c3e6cb"');
	});

	it("removed node is styled with red fillcolor", () => {
		const a = analyze("req >> design -> spec\n");
		const b = analyze("design -> spec\n");
		const dot = exportDiffDot(a.graph, a.frontmatter, b.graph, b.frontmatter);
		expect(dot).toContain('"req"');
		expect(dot).toContain('fillcolor="#f5c6cb"');
	});

	it("changed node via status flip is styled with yellow fillcolor", () => {
		const srcA = `---
artifact:
  spec: { status: todo }
---
spec >> P -> X
`;
		const srcB = `---
artifact:
  spec: { status: done }
---
spec >> P -> X
`;
		const a = analyze(srcA);
		const b = analyze(srcB);
		const dot = exportDiffDot(a.graph, a.frontmatter, b.graph, b.frontmatter);
		expect(dot).toContain('"spec"');
		expect(dot).toContain('fillcolor="#ffeeba"');
	});

	it("context node anchored by added edge appears with context color; isolated unchanged node is absent", () => {
		// a: spec -> design (primary). Also isolated node "isolated".
		const srcA = "spec >> design -> out\nisolated >> P2 -> sink\n";
		// b: same plus added edge spec >> newproc, "isolated" remains
		const srcB =
			"spec >> design -> out\nspec >> newproc -> out2\nisolated >> P2 -> sink\n";
		const a = analyze(srcA);
		const b = analyze(srcB);
		const dot = exportDiffDot(a.graph, a.frontmatter, b.graph, b.frontmatter);
		// "spec" is an endpoint of the added edge "spec >> newproc" → context node
		expect(dot).toContain('"spec"');
		expect(dot).toContain("#777777");
		// "isolated" is unchanged and NOT an endpoint of any added/removed edge → absent
		expect(dot).not.toContain('"isolated"');
	});

	it("empty diff (identical inputs) emits _nodiff node", () => {
		const src = "req >> design -> spec\n";
		const a = analyze(src);
		const b = analyze(src);
		const dot = exportDiffDot(a.graph, a.frontmatter, b.graph, b.frontmatter);
		expect(dot).toContain("_nodiff");
		expect(dot).toContain("No structural or metadata changes");
	});

	it("output starts with digraph PFDSL { and ends with }\\n", () => {
		const a = analyze("req >> design -> spec\n");
		const b = analyze("req >> design -> spec\nnewnode >> design\n");
		const dot = exportDiffDot(a.graph, a.frontmatter, b.graph, b.frontmatter);
		expect(dot.startsWith("digraph PFDSL {")).toBe(true);
		expect(dot.endsWith("}\n")).toBe(true);
	});
});
