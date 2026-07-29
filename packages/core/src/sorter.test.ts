import { describe, expect, it } from "vitest";
import { buildGraph } from "./graph.js";
import { lex } from "./lexer.js";
import { normalize } from "./normalizer.js";
import { parseTokens } from "./parser.js";
import { computeTopoOrder, sortEdges } from "./sorter.js";
import type { Frontmatter, NormalizedEdge } from "./types/index.js";

function sorted(src: string): NormalizedEdge[] {
	const { tokens } = lex(src);
	const { document } = parseTokens(tokens);
	const { edges, nodeKinds } = normalize(document, null);
	const graph = buildGraph(edges, nodeKinds);
	return sortEdges(edges, graph);
}

function topoOrder(
	src: string,
	frontmatter: Frontmatter | null = null,
): string[] {
	const { tokens } = lex(src);
	const { document } = parseTokens(tokens);
	const { edges, nodeKinds } = normalize(document, frontmatter);
	const graph = buildGraph(edges, nodeKinds);
	return computeTopoOrder(edges, graph, frontmatter);
}

describe("sortEdges", () => {
	it("simple chain: input before output", () => {
		const result = sorted("A >> P -> B");
		expect(result[0]).toEqual({ kind: "input", artifact: "A", process: "P" });
		expect(result[1]).toEqual({ kind: "output", process: "P", artifact: "B" });
	});

	it("sequential chain: rank-driven full edge order A >> P -> B >> Q -> C (locks spec §14.2)", () => {
		// ranks: A=0, P=1, B=2, Q=3, C=4. Edges sort by source-side rank, then kind, then lex.
		const result = sorted("A >> P -> B >> Q -> C");
		expect(result).toEqual([
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
			{ kind: "input", artifact: "B", process: "Q" },
			{ kind: "output", process: "Q", artifact: "C" },
		]);
	});

	it("merge shape: input edges sort by source-side (upstream) rank, not process-side rank", () => {
		// D(0) >> E(1) -> A(2); Z(0) >> P(3); A(2) >> P(3) -> Out(4).
		// Both A>>P and Z>>P share the same process (P, rank 3), so a
		// process-side edgeRank would tie them and fall back to the lex
		// tiebreak (A before Z). The current source-side rule instead ranks
		// them by artifact rank (Z=0 before A=2), producing [Z, A] under P.
		// A chain fixture can't distinguish these two rules — see #646.
		const result = sorted("D >> E -> A\nZ >> P\nA >> P -> Out");
		const intoP = result.filter((e) => e.kind === "input" && e.process === "P");
		expect(intoP).toEqual([
			{ kind: "input", artifact: "Z", process: "P" },
			{ kind: "input", artifact: "A", process: "P" },
		]);
	});

	it("within same rank: >> before ->", () => {
		const result = sorted("[a, b] >> P -> [x, y]");
		const inputs = result.filter((e) => e.kind === "input");
		const outputs = result.filter((e) => e.kind === "output");
		expect(inputs.length).toBe(2);
		expect(outputs.length).toBe(2);
		const firstOutputIdx = result.findIndex((e) => e.kind === "output");
		const lastInputIdx = result.map((e) => e.kind).lastIndexOf("input");
		expect(lastInputIdx).toBeLessThan(firstOutputIdx);
	});

	it("lexicographic ordering within same rank and type", () => {
		const result = sorted("[b, a] >> P -> B");
		const inputs = result.filter((e) => e.kind === "input");
		expect(inputs[0]).toEqual({ kind: "input", artifact: "a", process: "P" });
		expect(inputs[1]).toEqual({ kind: "input", artifact: "b", process: "P" });
	});

	it("feedback edges placed by process rank (spec §14.5): sits between target process inputs and outputs", () => {
		// Chain: req(0) >> design(1) -> spec(2) >> impl(3) -> code(4)
		// Feedback spec >>? impl: source artifact is in main component; edge rank = impl rank (3).
		// At rank 3, kind ordering puts feedback (1) before output (2).
		const result = sorted(
			"req >> design -> spec\nspec >> impl -> code\nspec >>? impl",
		);
		expect(result).toEqual([
			{ kind: "input", artifact: "req", process: "design" },
			{ kind: "output", process: "design", artifact: "spec" },
			{ kind: "input", artifact: "spec", process: "impl" },
			{ kind: "feedback", artifact: "spec", process: "impl" },
			{ kind: "output", process: "impl", artifact: "code" },
		]);
	});

	it("separate connected components: smaller min-ID component first", () => {
		const result = sorted("x >> P2 -> y\na >> P1 -> b");
		expect(result[0]).toMatchObject({ artifact: "a" });
	});

	// The case above passes whether the component is keyed by its smallest or
	// its largest id — a/b sort before x/y either way. Here the two answers
	// disagree: keyed by min, {m,z} (m) comes before {n}; keyed by max, {m,z}
	// (z) comes after (#637).
	it("keys a component by its smallest id, not its largest", () => {
		const result = sorted("m >> P1 -> z\nn >> P2 -> o");
		expect(result[0]).toMatchObject({ artifact: "m" });
	});

	// The timeout is the non-termination check: a cycle that made ranking loop
	// forever would hang here rather than return. Measuring elapsed time inside
	// the test instead would assert on machine speed, not on termination.
	it("cyclic primary graph: terminates and emits all edges with rank-0 fallback", {
		timeout: 1000,
	}, () => {
		// A -> P1 -> B -> P2 -> A forms a cycle on the primary graph.
		// No source ⇒ all ranks fall back to 0 ⇒ stable sort by kind then lex key.
		const result = sorted("A >> P1 -> B\nB >> P2 -> A");
		expect(result).toEqual([
			{ kind: "input", artifact: "A", process: "P1" },
			{ kind: "input", artifact: "B", process: "P2" },
			{ kind: "output", process: "P1", artifact: "B" },
			{ kind: "output", process: "P2", artifact: "A" },
		]);
	});
});

describe("computeTopoOrder", () => {
	it("orders a simple chain: artifact, process, artifact, ...", () => {
		expect(topoOrder("A >> P -> B")).toEqual(["A", "P", "B"]);
	});

	it("dedupes ids shared across edges (each node appears once)", () => {
		expect(topoOrder("A >> P -> B >> Q -> C")).toEqual([
			"A",
			"P",
			"B",
			"Q",
			"C",
		]);
	});

	it("appends frontmatter-declared nodes not reachable via any edge, sorted", () => {
		const frontmatter: Frontmatter = {
			artifact: { Z: {}, Y: {} },
			process: {},
		};
		expect(topoOrder("A >> P -> B", frontmatter)).toEqual([
			"A",
			"P",
			"B",
			"Y",
			"Z",
		]);
	});
});
