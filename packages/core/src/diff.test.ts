import { describe, expect, it } from "vitest";
import { diffGraphs } from "./diff.js";
import { analyze } from "./index.js";

describe("diffGraphs", () => {
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
