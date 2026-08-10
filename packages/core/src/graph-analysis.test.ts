import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph.js";
import {
	computeDependsOn,
	computeImpact,
	computeNeighbors,
	computeOrphans,
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
	// `report >>? design`: the report feeds back into the process that produced
	// the spec it reviews.
	const withFeedback = buildGraph(
		[...edges, { kind: "feedback", artifact: "report", process: "design" }],
		kinds,
	);

	it("returns predecessors (in-edges) and successors (out-edges) of an artifact", () => {
		expect(computeNeighbors(graph, "spec")).toEqual({
			predecessors: [{ id: "design", kind: "primary" }],
			successors: [
				{ id: "build", kind: "primary" },
				{ id: "review", kind: "primary" },
			],
		});
	});

	it("returns predecessors and successors of a process", () => {
		expect(computeNeighbors(graph, "build")).toEqual({
			predecessors: [{ id: "spec", kind: "primary" }],
			successors: [{ id: "code", kind: "primary" }],
		});
	});

	it("returns empty arrays for a node with no edges on one side", () => {
		expect(computeNeighbors(graph, "req")).toEqual({
			predecessors: [],
			successors: [{ id: "design", kind: "primary" }],
		});
	});

	// A `>>?` neighbor is a direct edge of the node, so a query for direct
	// neighbors that omits it returns an image with the feedback wiring missing
	// — which is exactly what audits of feedback wiring use this for (#828).
	it("reports the artifact of an incoming feedback edge as a predecessor", () => {
		expect(computeNeighbors(withFeedback, "design")).toEqual({
			predecessors: [
				{ id: "req", kind: "primary" },
				{ id: "report", kind: "feedback" },
			],
			successors: [{ id: "spec", kind: "primary" }],
		});
	});

	it("reports the process of an outgoing feedback edge as a successor", () => {
		expect(computeNeighbors(withFeedback, "report")).toEqual({
			predecessors: [{ id: "review", kind: "primary" }],
			successors: [{ id: "design", kind: "feedback" }],
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
	// The test below only pins the top entry, which is the sole node with the
	// highest degree — the "then id asc" half of the contract went unchecked
	// even though the fixture has three nodes tied at degree 2 (#637).
	it("breaks a degree tie by id, ascending", () => {
		const tied = computeStats(graph)
			.filter((s) => s.fanIn + s.fanOut === 2)
			.map((s) => s.id);
		expect(tied).toEqual([...tied].sort());
		expect(tied.length).toBeGreaterThan(1);
	});

	it("computes fan-in/fan-out per node, sorted by total degree desc then id asc", () => {
		const stats = computeStats(graph);
		const spec = stats.find((s) => s.id === "spec");
		expect(spec).toEqual({ id: "spec", kind: "artifact", fanIn: 1, fanOut: 2 });
		// spec has the highest total degree (3) among all nodes
		expect(stats[0]?.id).toBe("spec");
	});
});

describe("computeOrphans", () => {
	it("returns nothing when every node carries a primary edge", () => {
		expect(computeOrphans(graph)).toEqual([]);
	});

	it("returns a node wired to nothing at all", () => {
		const withStray = buildGraph(
			edges,
			new Map([...kinds, ["stray", "artifact"]]),
		);
		expect(computeOrphans(withStray)).toEqual([
			{ id: "stray", kind: "artifact" },
		]);
	});

	// A group is a container for artifacts and processes and never carries an
	// edge, so counting it as a node makes every group in the file an orphan.
	// Measured before the fix: runtime-pipeline.pfdsl reported 5 orphans, all 5
	// of them groups (#676).
	it("never reports a group, which by construction has no edges", () => {
		const withGroup = buildGraph(
			edges,
			new Map<string, "artifact" | "process" | "group">([
				...kinds,
				["planning", "group"],
			]),
		);
		expect(computeOrphans(withGroup)).toEqual([]);
	});

	// A node reachable only by `>>?` is a shape the notation supports on
	// purpose: workflow.pfdsl's pfdsl_skill says so in its own description
	// (#704). "Fully disconnected" is what the help text already promises.
	it("does not report a node held only by a feedback edge", () => {
		const withFeedback = buildGraph(
			[...edges, { kind: "feedback", artifact: "guide", process: "review" }],
			new Map([...kinds, ["guide", "artifact"]]),
		);
		expect(computeOrphans(withFeedback)).toEqual([]);
	});

	it("reports a node whose only would-be partner is itself unwired", () => {
		const two = buildGraph(
			edges,
			new Map([...kinds, ["stray_a", "artifact"], ["stray_b", "artifact"]]),
		);
		expect(computeOrphans(two).map((o) => o.id)).toEqual([
			"stray_a",
			"stray_b",
		]);
	});
});
