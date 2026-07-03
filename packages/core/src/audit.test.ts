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

	describe("consumerAsymmetry", () => {
		it("emits a hint when one same-group artifact's consumers are a strict subset of another's", () => {
			// Group "g": lib >> use_a -> out_a, lib >> use_b -> out_b
			//             cli >> use_a -> out_a, cli >> use_b -> out_b, cli >> use_c -> out_c
			// lib consumers = {use_a, use_b}, cli consumers = {use_a, use_b, use_c}
			// lib ⊂ cli strictly → hint for lib missing use_c
			const edges = mkEdges(
				{ kind: "input", a: "lib", p: "use_a" },
				{ kind: "output", a: "out_a", p: "use_a" },
				{ kind: "input", a: "lib", p: "use_b" },
				{ kind: "output", a: "out_b", p: "use_b" },
				{ kind: "input", a: "cli", p: "use_a" },
				{ kind: "input", a: "cli", p: "use_b" },
				{ kind: "input", a: "cli", p: "use_c" },
				{ kind: "output", a: "out_c", p: "use_c" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["lib", "artifact"],
				["cli", "artifact"],
				["use_a", "process"],
				["use_b", "process"],
				["use_c", "process"],
				["out_a", "artifact"],
				["out_b", "artifact"],
				["out_c", "artifact"],
			]);
			const artifactMeta: Record<string, ArtifactMeta> = {
				lib: { group: "g" },
				cli: { group: "g" },
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.consumerAsymmetry).toHaveLength(1);
			expect(result.consumerAsymmetry[0]).toMatchObject({
				artifact: "lib",
				missingProcesses: ["use_c"],
				sibling: "cli",
			});
		});

		it("emits no hint when same-group artifacts have identical consumer sets", () => {
			const edges = mkEdges(
				{ kind: "input", a: "lib", p: "use_a" },
				{ kind: "output", a: "out_a", p: "use_a" },
				{ kind: "input", a: "cli", p: "use_a" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["lib", "artifact"],
				["cli", "artifact"],
				["use_a", "process"],
				["out_a", "artifact"],
			]);
			const artifactMeta: Record<string, ArtifactMeta> = {
				lib: { group: "g" },
				cli: { group: "g" },
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.consumerAsymmetry).toHaveLength(0);
		});

		it("emits no hint when same-group artifacts have disjoint consumer sets", () => {
			const edges = mkEdges(
				{ kind: "input", a: "lib", p: "use_a" },
				{ kind: "output", a: "out_a", p: "use_a" },
				{ kind: "input", a: "cli", p: "use_b" },
				{ kind: "output", a: "out_b", p: "use_b" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["lib", "artifact"],
				["cli", "artifact"],
				["use_a", "process"],
				["use_b", "process"],
				["out_a", "artifact"],
				["out_b", "artifact"],
			]);
			const artifactMeta: Record<string, ArtifactMeta> = {
				lib: { group: "g" },
				cli: { group: "g" },
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.consumerAsymmetry).toHaveLength(0);
		});

		it("emits no hint when artifacts are in different groups", () => {
			// lib in group g1, cli in group g2: no cross-group comparison
			const edges = mkEdges(
				{ kind: "input", a: "lib", p: "use_a" },
				{ kind: "output", a: "out_a", p: "use_a" },
				{ kind: "input", a: "cli", p: "use_a" },
				{ kind: "input", a: "cli", p: "use_b" },
				{ kind: "output", a: "out_b", p: "use_b" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["lib", "artifact"],
				["cli", "artifact"],
				["use_a", "process"],
				["use_b", "process"],
				["out_a", "artifact"],
				["out_b", "artifact"],
			]);
			const artifactMeta: Record<string, ArtifactMeta> = {
				lib: { group: "g1" },
				cli: { group: "g2" },
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.consumerAsymmetry).toHaveLength(0);
		});

		it("emits no hint for ungrouped artifacts even if one's consumers are a subset of another's", () => {
			const edges = mkEdges(
				{ kind: "input", a: "lib", p: "use_a" },
				{ kind: "output", a: "out_a", p: "use_a" },
				{ kind: "input", a: "cli", p: "use_a" },
				{ kind: "input", a: "cli", p: "use_b" },
				{ kind: "output", a: "out_b", p: "use_b" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["lib", "artifact"],
				["cli", "artifact"],
				["use_a", "process"],
				["use_b", "process"],
				["out_a", "artifact"],
				["out_b", "artifact"],
			]);
			// No group assigned
			const artifactMeta: Record<string, ArtifactMeta> = {
				lib: {},
				cli: {},
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.consumerAsymmetry).toHaveLength(0);
		});

		it("feedback edges do not count as consumption for asymmetry", () => {
			// lib feeds use_a via normal; cli feeds use_a normally AND use_b via feedback only
			// cli's normal consumers = {use_a} (same as lib) → no hint
			const edges = mkEdges(
				{ kind: "input", a: "lib", p: "use_a" },
				{ kind: "output", a: "out_a", p: "use_a" },
				{ kind: "input", a: "cli", p: "use_a" },
				{ kind: "feedback", a: "cli", p: "use_b" },
				{ kind: "output", a: "out_b", p: "use_b" },
			);
			const nodeKinds = new Map<string, NodeKind>([
				["lib", "artifact"],
				["cli", "artifact"],
				["use_a", "process"],
				["use_b", "process"],
				["out_a", "artifact"],
				["out_b", "artifact"],
			]);
			const artifactMeta: Record<string, ArtifactMeta> = {
				lib: { group: "g" },
				cli: { group: "g" },
			};
			const result = auditGraph(edges, nodeKinds, artifactMeta);
			expect(result.consumerAsymmetry).toHaveLength(0);
		});

		it("caps output at 10 hints and provides a count of the remainder", () => {
			// Generate 12 same-group artifacts where artifact_0 has consumers {p0}
			// and artifact_N (N>0) has consumers {p0, pN} — each is a superset of artifact_0
			// That gives 11 hints (artifact_0 ⊂ each of artifact_1..artifact_11)
			const edges: NormalizedEdge[] = [];
			const nodeKinds = new Map<string, NodeKind>();
			const artifactMeta: Record<string, ArtifactMeta> = {};

			// base artifact consumed only by p0
			edges.push({ kind: "input", artifact: "a0", process: "p0" });
			edges.push({ kind: "output", process: "p0", artifact: "out0" });
			nodeKinds.set("a0", "artifact");
			nodeKinds.set("p0", "process");
			nodeKinds.set("out0", "artifact");
			artifactMeta.a0 = { group: "g" };

			// 11 artifacts each consumed by p0 AND their own unique process
			for (let i = 1; i <= 11; i++) {
				const ai = `a${i}`;
				const pi = `p${i}`;
				const outi = `out${i}`;
				edges.push({ kind: "input", artifact: ai, process: "p0" });
				edges.push({ kind: "input", artifact: ai, process: pi });
				edges.push({ kind: "output", process: pi, artifact: outi });
				nodeKinds.set(ai, "artifact");
				nodeKinds.set(pi, "process");
				nodeKinds.set(outi, "artifact");
				artifactMeta[ai] = { group: "g" };
			}

			const result = auditGraph(edges, nodeKinds, artifactMeta);
			// a0 ⊂ each of a1..a11 → 11 hints total, capped at 10 + remainder
			expect(result.consumerAsymmetry.length).toBe(10);
			expect(result.consumerAsymmetryRemainder).toBe(1);
		});
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
