import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph.js";
import {
	computeDependsOn,
	computeImpact,
	computeNeighbors,
	computePaths,
	computeStats,
} from "./graph-analysis.js";
import type { NormalizedEdge } from "./types/index.js";

// req >> design -> spec >> build -> code
//                spec >> review -> report
const edges: NormalizedEdge[] = [
	{ kind: "input", artifact: "req", process: "design" },
	{ kind: "output", process: "design", artifact: "spec" },
	{ kind: "input", artifact: "spec", process: "build" },
	{ kind: "output", process: "build", artifact: "code" },
	{ kind: "input", artifact: "spec", process: "review" },
	{ kind: "output", process: "review", artifact: "report" },
];
const kinds = new Map<string, "artifact" | "process">([
	["req", "artifact"],
	["design", "process"],
	["spec", "artifact"],
	["build", "process"],
	["code", "artifact"],
	["review", "process"],
	["report", "artifact"],
]);
const graph = buildGraph(edges, kinds);

describe("computeNeighbors", () => {
	it("returns predecessors (in-edges) and successors (out-edges) of an artifact", () => {
		expect(computeNeighbors(graph, "spec")).toEqual({
			predecessors: ["design"],
			successors: ["build", "review"],
		});
	});

	it("returns predecessors and successors of a process", () => {
		expect(computeNeighbors(graph, "build")).toEqual({
			predecessors: ["spec"],
			successors: ["code"],
		});
	});

	it("returns empty arrays for a node with no edges on one side", () => {
		expect(computeNeighbors(graph, "req")).toEqual({
			predecessors: [],
			successors: ["design"],
		});
	});
});

describe("computeImpact", () => {
	it("returns the full downstream closure, excluding the node itself", () => {
		expect(computeImpact(graph, "spec").sort()).toEqual(
			["build", "code", "review", "report"].sort(),
		);
	});

	it("returns an empty array for a terminal node", () => {
		expect(computeImpact(graph, "code")).toEqual([]);
	});
});

describe("computeDependsOn", () => {
	it("returns the full upstream closure, excluding the node itself", () => {
		expect(computeDependsOn(graph, "code").sort()).toEqual(
			["req", "design", "spec", "build"].sort(),
		);
	});

	it("returns an empty array for a source node", () => {
		expect(computeDependsOn(graph, "req")).toEqual([]);
	});
});

describe("computePaths", () => {
	it("finds all simple paths between two connected nodes", () => {
		expect(computePaths(graph, "spec", "code")).toEqual([
			["spec", "build", "code"],
		]);
	});

	it("returns an empty array when no path exists", () => {
		expect(computePaths(graph, "code", "report")).toEqual([]);
	});

	it("returns a single-node path when from equals to and the node exists", () => {
		expect(computePaths(graph, "spec", "spec")).toEqual([["spec"]]);
	});
});

describe("computeStats", () => {
	it("computes fan-in/fan-out per node, sorted by total degree desc then id asc", () => {
		const stats = computeStats(graph);
		const spec = stats.find((s) => s.id === "spec");
		expect(spec).toEqual({ id: "spec", kind: "artifact", fanIn: 1, fanOut: 2 });
		// spec has the highest total degree (3) among all nodes
		expect(stats[0]?.id).toBe("spec");
	});
});
