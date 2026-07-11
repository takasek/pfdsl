import { describe, expect, it } from "vitest";
import { groupEdges } from "./edge-groups.js";
import type { NormalizedEdge } from "./types/index.js";

describe("groupEdges", () => {
	it("classifies input/output/feedback edges into separate process->artifact maps", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
			{ kind: "feedback", artifact: "C", process: "P" },
		];
		const groups = groupEdges(edges);
		expect(groups.processInputs.get("P")).toEqual(["A"]);
		expect(groups.processOutputs.get("P")).toEqual(["B"]);
		expect(groups.processFeedback.get("P")).toEqual(["C"]);
	});

	it("collects multiple artifacts per process, preserving edge order", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "input", artifact: "B", process: "P" },
			{ kind: "output", process: "P", artifact: "X" },
			{ kind: "output", process: "P", artifact: "Y" },
		];
		const groups = groupEdges(edges);
		expect(groups.processInputs.get("P")).toEqual(["A", "B"]);
		expect(groups.processOutputs.get("P")).toEqual(["X", "Y"]);
	});

	it("builds artifactConsumers as the reverse of processInputs (input edges only)", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "input", artifact: "A", process: "Q" },
			{ kind: "output", process: "P", artifact: "A" }, // output should not affect consumers
			{ kind: "feedback", artifact: "A", process: "R" }, // feedback should not affect consumers
		];
		const groups = groupEdges(edges);
		expect(groups.artifactConsumers.get("A")).toEqual(["P", "Q"]);
	});

	it("builds artifactProducers as the reverse of processOutputs (output edges only)", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "output", process: "P", artifact: "B" },
			{ kind: "output", process: "Q", artifact: "B" },
			{ kind: "input", artifact: "B", process: "R" }, // input should not affect producers
			{ kind: "feedback", artifact: "B", process: "S" }, // feedback should not affect producers
		];
		const groups = groupEdges(edges);
		expect(groups.artifactProducers.get("B")).toEqual(["P", "Q"]);
	});

	it("returns empty maps for an empty edge list", () => {
		const groups = groupEdges([]);
		expect(groups.processInputs.size).toBe(0);
		expect(groups.processOutputs.size).toBe(0);
		expect(groups.processFeedback.size).toBe(0);
		expect(groups.artifactConsumers.size).toBe(0);
		expect(groups.artifactProducers.size).toBe(0);
	});
});
