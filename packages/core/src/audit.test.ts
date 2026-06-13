import { describe, expect, it } from "vitest";
import { auditGraph } from "./audit.js";
import type { NodeKind, NormalizedEdge } from "./types/index.js";

function mkEdges(
	...specs: Array<{
		kind: "input" | "output" | "feedback";
		a: string;
		p: string;
	}>
): NormalizedEdge[] {
	return specs.map((s) => {
		if (s.kind === "output")
			return { kind: "output", process: s.p, artifact: s.a };
		return { kind: s.kind, artifact: s.a, process: s.p };
	});
}

describe("auditGraph", () => {
	it("identifies a terminal artifact (output of a process but not consumed by any process)", () => {
		// req >> design -> spec   (spec is a terminal: produced but never consumed)
		const edges = mkEdges(
			{ kind: "input", a: "req", p: "design" },
			{ kind: "output", a: "spec", p: "design" },
		);
		const nodeKinds = new Map<string, NodeKind>([
			["req", "artifact"],
			["design", "process"],
			["spec", "artifact"],
		]);
		const result = auditGraph(edges, nodeKinds);
		expect(result.terminals).toContain("spec");
		expect(result.terminals).not.toContain("req");
	});

	it("identifies an external input (consumed but never produced by any process)", () => {
		// req >> design -> spec  (req is external: consumed but never produced)
		const edges = mkEdges(
			{ kind: "input", a: "req", p: "design" },
			{ kind: "output", a: "spec", p: "design" },
		);
		const nodeKinds = new Map<string, NodeKind>([
			["req", "artifact"],
			["design", "process"],
			["spec", "artifact"],
		]);
		const result = auditGraph(edges, nodeKinds);
		expect(result.externalInputs).toContain("req");
		expect(result.externalInputs).not.toContain("spec");
	});

	it("an artifact used as both input and output of different processes is neither terminal nor external", () => {
		// req >> design -> spec\nspec >> impl -> code
		const edges = mkEdges(
			{ kind: "input", a: "req", p: "design" },
			{ kind: "output", a: "spec", p: "design" },
			{ kind: "input", a: "spec", p: "impl" },
			{ kind: "output", a: "code", p: "impl" },
		);
		const nodeKinds = new Map<string, NodeKind>([
			["req", "artifact"],
			["design", "process"],
			["spec", "artifact"],
			["impl", "process"],
			["code", "artifact"],
		]);
		const result = auditGraph(edges, nodeKinds);
		expect(result.terminals).not.toContain("spec");
		expect(result.externalInputs).not.toContain("spec");
		// req is external, code is terminal
		expect(result.externalInputs).toContain("req");
		expect(result.terminals).toContain("code");
	});

	it("feedback edges do not count as production or consumption for audit", () => {
		// a >> p -> b   b >>? p  — b is feedback but primary-graph terminal
		const edges = mkEdges(
			{ kind: "input", a: "a", p: "p" },
			{ kind: "output", a: "b", p: "p" },
			{ kind: "feedback", a: "b", p: "p" },
		);
		const nodeKinds = new Map<string, NodeKind>([
			["a", "artifact"],
			["p", "process"],
			["b", "artifact"],
		]);
		const result = auditGraph(edges, nodeKinds);
		expect(result.terminals).toContain("b");
		expect(result.externalInputs).toContain("a");
	});

	it("returns empty arrays when there are no artifact nodes", () => {
		const result = auditGraph([], new Map());
		expect(result.terminals).toEqual([]);
		expect(result.externalInputs).toEqual([]);
	});
});
