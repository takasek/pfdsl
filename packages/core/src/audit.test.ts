import { describe, expect, it } from "vitest";
import { auditGraph } from "./audit.js";
import type { ArtifactMeta } from "./types/frontmatter.js";
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

	describe("externalStakeholders", () => {
		it("artifact with externalStakeholders is not flagged as orphan terminal", () => {
			// req >> design -> report   (report has externalStakeholders)
			const edges = mkEdges(
				{ kind: "input", a: "req", p: "design" },
				{ kind: "output", a: "report", p: "design" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["req", "artifact"],
				["design", "process"],
				["report", "artifact"],
			]);
			const artifactMeta: Record<string, ArtifactMeta> = {
				report: { externalStakeholders: ["規制当局"] },
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.terminals).not.toContain("report");
		});

		it("artifact with empty externalStakeholders is still flagged as orphan terminal", () => {
			const edges = mkEdges(
				{ kind: "input", a: "req", p: "design" },
				{ kind: "output", a: "report", p: "design" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["req", "artifact"],
				["design", "process"],
				["report", "artifact"],
			]);
			const artifactMeta: Record<string, ArtifactMeta> = {
				report: { externalStakeholders: [] },
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.terminals).toContain("report");
		});

		it("artifact with externalStakeholders and a consuming edge is neither terminal nor flagged", () => {
			// req >> design -> report >> publish -> published   (report has externalStakeholders but also consumed)
			const edges = mkEdges(
				{ kind: "input", a: "req", p: "design" },
				{ kind: "output", a: "report", p: "design" },
				{ kind: "input", a: "report", p: "publish" },
				{ kind: "output", a: "published", p: "publish" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["req", "artifact"],
				["design", "process"],
				["report", "artifact"],
				["publish", "process"],
				["published", "artifact"],
			]);
			const artifactMeta: Record<string, ArtifactMeta> = {
				report: { externalStakeholders: ["外部ユーザー"] },
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.terminals).not.toContain("report");
			expect(result.terminals).toContain("published");
		});
	});
});
