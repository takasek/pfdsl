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
});
