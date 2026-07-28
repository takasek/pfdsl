import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph.js";
import type { NormalizedEdge } from "./types/index.js";

describe("buildGraph", () => {
	it("input edges: artifact→process in primaryEdges", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
		];
		const kinds = new Map([
			["A", "artifact" as const],
			["P", "process" as const],
		]);
		const g = buildGraph(edges, kinds);
		expect(g.primaryEdges).toContainEqual({
			from: "A",
			to: "P",
			kind: "input",
		});
	});

	it("output edges: process→artifact in primaryEdges", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "output", process: "P", artifact: "B" },
		];
		const kinds = new Map([
			["P", "process" as const],
			["B", "artifact" as const],
		]);
		const g = buildGraph(edges, kinds);
		expect(g.primaryEdges).toContainEqual({
			from: "P",
			to: "B",
			kind: "output",
		});
	});

	it("feedback edges go to feedbackEdges, not primaryEdges", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "feedback", artifact: "A", process: "P" },
		];
		const kinds = new Map([
			["A", "artifact" as const],
			["P", "process" as const],
		]);
		const g = buildGraph(edges, kinds);
		expect(g.primaryEdges).toHaveLength(0);
		expect(g.feedbackEdges).toContainEqual({ artifact: "A", process: "P" });
	});

	describe("nodes absent from nodeKinds are inferred from their edge role", () => {
		it.each([
			["input", { kind: "input", artifact: "A", process: "P" }],
			["output", { kind: "output", process: "P", artifact: "A" }],
			["feedback", { kind: "feedback", artifact: "A", process: "P" }],
		] as [string, NormalizedEdge][])("%s edges", (_name, edge) => {
			const g = buildGraph([edge], new Map());
			expect(g.nodes.get("A")).toBe("artifact");
			expect(g.nodes.get("P")).toBe("process");
			expect(g.nodes.size).toBe(2);
		});
	});

	it("keeps the declared kind when only one side of an edge is in nodeKinds", () => {
		// A group node is declared, so the edge role must not re-register it as
		// an artifact; only the undeclared side is inferred.
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
		];
		const g = buildGraph(edges, new Map([["A", "group" as const]]));
		expect(g.nodes.get("A")).toBe("group");
		expect(g.nodes.get("P")).toBe("process");
	});

	it("nodes map is populated from nodeKinds", () => {
		const edges: NormalizedEdge[] = [];
		const kinds = new Map([
			["A", "artifact" as const],
			["P", "process" as const],
		]);
		const g = buildGraph(edges, kinds);
		expect(g.nodes.get("A")).toBe("artifact");
		expect(g.nodes.get("P")).toBe("process");
	});
});
