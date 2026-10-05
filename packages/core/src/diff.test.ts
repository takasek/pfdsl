import { describe, expect, it } from "vitest";
import { diffGraphs, diffGraphsDetailed } from "./diff.js";
import { analyze, formatId } from "./index.js";

describe("diffGraphs", () => {
	const collisionBase =
		'["a -> b", a] >> hub -> seed\nseed >> c -> out1\nseed >> "b -> c" -> out2\n';
	it.each([
		">>",
		">>?",
	])("keeps unchanged and removed colliding edges distinct for %s", (op) => {
		const a = analyze(
			`${collisionBase}"a -> b" ${op} c\na ${op} "b -> c"\n`,
		).graph;
		const b = analyze(`${collisionBase}a ${op} "b -> c"\n`).graph;
		const detailed = diffGraphsDetailed(a, b);
		const edges = op === ">>" ? detailed.primaryEdges : detailed.feedbackEdges;
		expect(edges.filter((edge) => edge.status === "removed")).toHaveLength(1);
		expect(edges.filter((edge) => edge.status === "added")).toHaveLength(0);
		expect(detailed.report).toEqual(diffGraphs(a, b));
		expect(diffGraphs(b, b).addedEdges).toEqual([]);
	});
	it("ignores duplicate edges and input order, keeping primary and feedback separate", () => {
		const a = analyze("req >> design -> spec\nreq >>? design\n").graph;
		const b = {
			...a,
			primaryEdges: [...a.primaryEdges, ...a.primaryEdges].reverse(),
			feedbackEdges: [...a.feedbackEdges, ...a.feedbackEdges],
		};
		const detailed = diffGraphsDetailed(a, b);
		expect(detailed.primaryEdges).toHaveLength(2);
		expect(detailed.feedbackEdges).toHaveLength(1);
		expect(
			[...detailed.primaryEdges, ...detailed.feedbackEdges].every(
				(edge) => edge.status === "unchanged",
			),
		).toBe(true);
		expect(detailed.report.addedEdges).toEqual([]);
		expect(detailed.report.removedEdges).toEqual([]);
		const changed = diffGraphs(a, { ...a, feedbackEdges: [] });
		expect(changed.removedFeedback).toEqual(["req -> design"]);
		expect(changed.removedEdges).toEqual([]);
	});
	it.each([
		["a >> b", '"a >> b"'],
		['a"b', '"a\\"b"'],
		["a\\b", '"a\\\\b"'],
		["a\nb", '"a\\nb"'],
		["a\tb", '"a\\tb"'],
	])("quotes and escapes the endpoint %j for display", (id, spelling) => {
		const parsed = analyze(`${formatId(id)} >> proc -> out\n`);
		expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual(
			[],
		);
		const r = diffGraphs(analyze("").graph, parsed.graph);
		expect(r.addedEdges).toContain(`${spelling} -> proc`);
	});
	it("does not use NUL as an identity delimiter for manually constructed Graphs", () => {
		const a = analyze("").graph;
		const b = {
			...a,
			primaryEdges: [
				{ from: "a\0b", to: "c", kind: "input" as const },
				{ from: "a", to: "b\0c", kind: "input" as const },
			],
		};
		expect(diffGraphsDetailed(a, b).primaryEdges).toHaveLength(2);
		expect(diffGraphs(a, b).addedEdges).toHaveLength(2);
	});
	it.each([
		">>",
		">>?",
	])("distinguishes colliding endpoint pairs for %s", (op) => {
		const a = analyze(`${collisionBase}"a -> b" ${op} c\n`);
		const b = analyze(`${collisionBase}a ${op} "b -> c"\n`);
		expect(a.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(b.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		const r = diffGraphs(a.graph, b.graph);
		expect(r.addedNodes).toEqual([]);
		expect(r.removedNodes).toEqual([]);
		expect(op === ">>" ? r.addedEdges : r.addedFeedback).toEqual([
			'a -> "b -> c"',
		]);
		expect(op === ">>" ? r.removedEdges : r.removedFeedback).toEqual([
			'"a -> b" -> c',
		]);
	});
	it.each([
		">>",
		">>?",
	])("retains both colliding edges in one graph for %s", (op) => {
		const a = analyze(collisionBase).graph;
		const b = analyze(
			`${collisionBase}"a -> b" ${op} c\na ${op} "b -> c"\n`,
		).graph;
		const r = diffGraphs(a, b);
		expect(op === ">>" ? r.addedEdges : r.addedFeedback).toEqual([
			'"a -> b" -> c',
			'a -> "b -> c"',
		]);
		const reverse = diffGraphs(b, a);
		expect(
			op === ">>" ? reverse.removedEdges : reverse.removedFeedback,
		).toEqual(['"a -> b" -> c', 'a -> "b -> c"']);
	});
	it("reports no differences for identical graphs", () => {
		const g = analyze("req >> design -> spec\n").graph;
		const r = diffGraphs(g, g);
		expect(r.addedNodes).toEqual([]);
		expect(r.removedNodes).toEqual([]);
		expect(r.addedEdges).toEqual([]);
		expect(r.removedEdges).toEqual([]);
		expect(r.addedFeedback).toEqual([]);
		expect(r.removedFeedback).toEqual([]);
	});

	it("reports added nodes and edges", () => {
		const a = analyze("req >> design -> spec\n").graph;
		const b = analyze("req >> design -> spec\nspec >> impl -> code\n").graph;
		const r = diffGraphs(a, b);
		expect(r.addedNodes).toEqual(["code", "impl"]);
		expect(r.addedEdges).toContain("spec -> impl");
		expect(r.addedEdges).toContain("impl -> code");
		expect(r.removedNodes).toEqual([]);
		expect(r.removedEdges).toEqual([]);
	});

	it("reports removed nodes and edges", () => {
		const a = analyze("req >> design -> spec\nspec >> impl -> code\n").graph;
		const b = analyze("req >> design -> spec\n").graph;
		const r = diffGraphs(a, b);
		expect(r.removedNodes).toEqual(["code", "impl"]);
		expect(r.removedEdges).toContain("spec -> impl");
		expect(r.removedEdges).toContain("impl -> code");
		expect(r.addedNodes).toEqual([]);
		expect(r.addedEdges).toEqual([]);
	});

	it("reports added feedback edge", () => {
		const a = analyze("spec >> impl -> code\n").graph;
		const b = analyze("spec >> impl -> code\ncode >>? impl\n").graph;
		const r = diffGraphs(a, b);
		expect(r.addedFeedback).toEqual(["code -> impl"]);
		expect(r.removedFeedback).toEqual([]);
	});

	it("reports removed feedback edge", () => {
		const a = analyze("spec >> impl -> code\ncode >>? impl\n").graph;
		const b = analyze("spec >> impl -> code\n").graph;
		const r = diffGraphs(a, b);
		expect(r.removedFeedback).toEqual(["code -> impl"]);
		expect(r.addedFeedback).toEqual([]);
	});

	describe("changedNodes", () => {
		const metadata = {
			artifact: { spec: { label: "Specification" } },
			process: { design: { label: "Design" } },
			group: { team: { label: "Team" } },
		};
		const metadataGraph = analyze("req >> design -> spec\n").graph;
		metadataGraph.nodes.set("team", "group");

		it.each([
			[null, metadata],
			[metadata, null],
		])("detects metadata addition or removal with an explicit null (%j → %j)", (before, after) => {
			const detailed = diffGraphsDetailed(
				metadataGraph,
				metadataGraph,
				before,
				after,
			);
			expect(detailed.report.changedNodes).toEqual(["design", "spec", "team"]);
			expect(detailed.report).toEqual(
				diffGraphs(metadataGraph, metadataGraph, before, after),
			);
			expect(detailed.report.addedNodes).toEqual([]);
			expect(detailed.report.removedNodes).toEqual([]);
		});

		it.each([
			[null, null],
			[null, {}],
			[{}, null],
		])("treats explicit null as empty metadata (%j → %j)", (before, after) => {
			expect(
				diffGraphsDetailed(metadataGraph, metadataGraph, before, after).report
					.changedNodes,
			).toEqual([]);
		});

		it.each([
			[undefined, metadata],
			[metadata, undefined],
			[undefined, null],
			[null, undefined],
			[undefined, undefined],
		])("skips metadata comparison when either argument is unspecified (%j → %j)", (before, after) => {
			expect(
				diffGraphsDetailed(metadataGraph, metadataGraph, before, after).report
					.changedNodes,
			).toEqual([]);
		});

		it("detects status flip via frontmatter (artifact todo→done)", () => {
			const srcA = `---
artifact:
  spec:
    status: todo
---
req >> design -> spec
`;
			const srcB = `---
artifact:
  spec:
    status: done
---
req >> design -> spec
`;
			const a = analyze(srcA);
			const b = analyze(srcB);
			const r = diffGraphs(a.graph, b.graph, a.frontmatter, b.frontmatter);
			expect(r.changedNodes).toEqual(["spec"]);
		});

		it("detects label change on a process", () => {
			const srcA = `---
process:
  design:
    label: Design
---
req >> design -> spec
`;
			const srcB = `---
process:
  design:
    label: Detailed Design
---
req >> design -> spec
`;
			const a = analyze(srcA);
			const b = analyze(srcB);
			const r = diffGraphs(a.graph, b.graph, a.frontmatter, b.frontmatter);
			expect(r.changedNodes).toEqual(["design"]);
		});

		it("reports changedNodes empty when metadata is identical", () => {
			const src = `---
artifact:
  spec:
    status: done
---
req >> design -> spec
`;
			const a = analyze(src);
			const b = analyze(src);
			const r = diffGraphs(a.graph, b.graph, a.frontmatter, b.frontmatter);
			expect(r.changedNodes).toEqual([]);
		});

		// Both sides come through the same parser everywhere else, so their keys
		// are always inserted in the same order and the sort in stableStringify
		// never mattered. Hand-built frontmatters disagree on order (#637).
		it("reports changedNodes empty when the same fields are written in a different order", () => {
			const graph = analyze("req >> design -> spec\n").graph;
			const a = { artifact: { spec: { status: "done", criteria: "x" } } };
			const b = { artifact: { spec: { criteria: "x", status: "done" } } };
			const r = diffGraphs(
				graph,
				graph,
				a as unknown as Parameters<typeof diffGraphs>[2],
				b as unknown as Parameters<typeof diffGraphs>[3],
			);
			expect(r.changedNodes).toEqual([]);
		});

		it("still reports a node whose field value actually differs", () => {
			const graph = analyze("req >> design -> spec\n").graph;
			const a = { artifact: { spec: { status: "done", criteria: "x" } } };
			const b = { artifact: { spec: { criteria: "y", status: "done" } } };
			const r = diffGraphs(
				graph,
				graph,
				a as unknown as Parameters<typeof diffGraphs>[2],
				b as unknown as Parameters<typeof diffGraphs>[3],
			);
			expect(r.changedNodes).toEqual(["spec"]);
		});

		it("reports changedNodes empty when frontmatters are omitted (2-arg call)", () => {
			const srcA = `---
artifact:
  spec:
    status: todo
---
req >> design -> spec
`;
			const srcB = `---
artifact:
  spec:
    status: done
---
req >> design -> spec
`;
			const a = analyze(srcA);
			const b = analyze(srcB);
			// 2-arg call — no frontmatter passed, so changedNodes must be empty
			const r = diffGraphs(a.graph, b.graph);
			expect(r.changedNodes).toEqual([]);
		});

		it("detects kind change (same id is artifact in one graph and process in the other)", () => {
			// In "req >> shared -> spec", "shared" is a process.
			// In "req >> design -> shared", "shared" is an artifact.
			const a = analyze("req >> shared -> spec\n");
			const b = analyze("req >> design -> shared\n");
			// "shared" appears in both graphs but with different kinds
			const r = diffGraphs(a.graph, b.graph);
			expect(r.changedNodes).toContain("shared");
		});

		it("does not include added or removed nodes in changedNodes", () => {
			const srcA = `---
artifact:
  spec:
    status: todo
---
req >> design -> spec
`;
			const srcB = `---
artifact:
  spec:
    status: done
  code:
    status: wip
---
req >> design -> spec
spec >> impl -> code
`;
			const a = analyze(srcA);
			const b = analyze(srcB);
			const r = diffGraphs(a.graph, b.graph, a.frontmatter, b.frontmatter);
			// "code" and "impl" are added — must not appear in changedNodes
			expect(r.changedNodes).not.toContain("code");
			expect(r.changedNodes).not.toContain("impl");
			// "spec" is in both and its status changed
			expect(r.changedNodes).toEqual(["spec"]);
		});
	});
});
