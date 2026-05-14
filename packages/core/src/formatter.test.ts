import { describe, expect, it } from "vitest";
import {
	formatAsFlows,
	formatEdges,
	splitBodyIntoSegments,
} from "./formatter.js";
import { lex } from "./lexer.js";
import { normalize } from "./normalizer.js";
import { parseTokens } from "./parser.js";
import type { NormalizedEdge } from "./types/index.js";

describe("formatEdges", () => {
	it("empty list → empty string", () => {
		expect(formatEdges([])).toBe("");
	});

	it('input edge → "artifact >> process\\n"', () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
		];
		expect(formatEdges(edges)).toBe("A >> P\n");
	});

	it('feedback edge → "artifact >>? process\\n"', () => {
		const edges: NormalizedEdge[] = [
			{ kind: "feedback", artifact: "A", process: "P" },
		];
		expect(formatEdges(edges)).toBe("A >>? P\n");
	});

	it('output edge → "process -> artifact\\n"', () => {
		const edges: NormalizedEdge[] = [
			{ kind: "output", process: "P", artifact: "B" },
		];
		expect(formatEdges(edges)).toBe("P -> B\n");
	});

	it("multiple edges: one per line, trailing newline", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
		];
		expect(formatEdges(edges)).toBe("A >> P\nP -> B\n");
	});

	it("IDs with spaces use as-is (formatter trusts input — known spec gap; output is not re-parseable as one ID)", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "my artifact", process: "P" },
		];
		const out = formatEdges(edges);
		expect(out).toBe("my artifact >> P\n");
		// Document the gap: spaced output is rejected on re-parse (not round-trip safe).
		const { tokens } = lex(out);
		const parsed = parseTokens(tokens);
		const norm = normalize(parsed.document, null);
		const allErrors = [...parsed.diagnostics, ...norm.diagnostics].filter(
			(d) => d.severity === "error",
		);
		expect(allErrors.length).toBeGreaterThan(0);
	});

	it("bare-id edges round-trip through lex/parse/normalize unchanged", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
		];
		const { tokens } = lex(formatEdges(edges));
		const parsed = parseTokens(tokens);
		const norm = normalize(parsed.document, null);
		const allErrors = [...parsed.diagnostics, ...norm.diagnostics].filter(
			(d) => d.severity === "error",
		);
		expect(allErrors).toHaveLength(0);
		expect(norm.edges).toEqual(edges);
	});

	it("isolated nodes output after edges", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
		];
		const result = formatEdges(edges, ["isolated_a", "isolated_b"]);
		expect(result).toBe("A >> P\nP -> B\nisolated_a\nisolated_b\n");
	});

	it("isolated-only (no edges) output", () => {
		const result = formatEdges([], ["lone"]);
		expect(result).toBe("lone\n");
	});
});

describe("splitBodyIntoSegments", () => {
	it("empty string → empty array", () => {
		expect(splitBodyIntoSegments("")).toEqual([]);
	});

	it("pure edge lines → single edge segment", () => {
		expect(splitBodyIntoSegments("A >> P\nP -> B\n")).toEqual([
			{ kind: "edges", text: "A >> P\nP -> B\n" },
		]);
	});

	it("comment-only body → single comment segment", () => {
		expect(splitBodyIntoSegments("# hello\n")).toEqual([
			{ kind: "comment", text: "# hello\n" },
		]);
	});

	it("blank line alone → comment segment", () => {
		expect(splitBodyIntoSegments("\n")).toEqual([
			{ kind: "comment", text: "\n" },
		]);
	});

	it("comment before edges → [comment, edges]", () => {
		expect(splitBodyIntoSegments("# section\nA >> P\n")).toEqual([
			{ kind: "comment", text: "# section\n" },
			{ kind: "edges", text: "A >> P\n" },
		]);
	});

	it("edges then comment → [edges, comment]", () => {
		expect(splitBodyIntoSegments("A >> P\n# tail\n")).toEqual([
			{ kind: "edges", text: "A >> P\n" },
			{ kind: "comment", text: "# tail\n" },
		]);
	});

	it("comment between edge blocks → three segments", () => {
		expect(splitBodyIntoSegments("A >> P\n# mid\nP -> B\n")).toEqual([
			{ kind: "edges", text: "A >> P\n" },
			{ kind: "comment", text: "# mid\n" },
			{ kind: "edges", text: "P -> B\n" },
		]);
	});

	it("blank line between edge blocks is treated as comment separator", () => {
		expect(splitBodyIntoSegments("A >> P\n\nP -> B\n")).toEqual([
			{ kind: "edges", text: "A >> P\n" },
			{ kind: "comment", text: "\n" },
			{ kind: "edges", text: "P -> B\n" },
		]);
	});

	it("inline comment after edge is part of edge segment (not split)", () => {
		// Lines starting with # are comment; lines not starting with # are edges
		// "A >> P # note" doesn't start with # → edge segment
		expect(splitBodyIntoSegments("A >> P # note\n")).toEqual([
			{ kind: "edges", text: "A >> P # note\n" },
		]);
	});
});

describe("formatAsFlows", () => {
	it("empty → empty string", () => {
		expect(formatAsFlows([])).toBe("");
	});

	it("input + output for same process → single chained line", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
		];
		expect(formatAsFlows(edges)).toBe("A >> P -> B\n");
	});

	it("multiple inputs → bracketed", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "input", artifact: "B", process: "P" },
			{ kind: "output", process: "P", artifact: "C" },
		];
		expect(formatAsFlows(edges)).toBe("[A, B] >> P -> C\n");
	});

	it("multiple outputs → bracketed", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
			{ kind: "output", process: "P", artifact: "C" },
		];
		expect(formatAsFlows(edges)).toBe("A >> P -> [B, C]\n");
	});

	it("input-only process (sink) → artifact >> process", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
		];
		expect(formatAsFlows(edges)).toBe("A >> P\n");
	});

	it("output-only process (source) → process -> artifact", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "output", process: "P", artifact: "B" },
		];
		expect(formatAsFlows(edges)).toBe("P -> B\n");
	});

	it("feedback edge → separate line before main statement", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "feedback", artifact: "X", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
		];
		expect(formatAsFlows(edges)).toBe("X >>? P\nA >> P -> B\n");
	});

	it("same rank: processes sorted alphabetically", () => {
		// P_a and P_b both at rank 1; A feeds both.
		// sortEdges emits input edges lex-sorted (A\0P_a < A\0P_b),
		// then output edges lex-sorted (P_a\0Y < P_b\0X) → P_a rankProxy < P_b.
		// Tiebreaker: localeCompare ensures alphabetical when rankProxy equals.
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P_a" },
			{ kind: "input", artifact: "A", process: "P_b" },
			{ kind: "output", process: "P_a", artifact: "Y" },
			{ kind: "output", process: "P_b", artifact: "X" },
		];
		const result = formatAsFlows(edges);
		const lines = result.trimEnd().split("\n");
		expect(lines[0]).toMatch(/P_a/);
		expect(lines[1]).toMatch(/P_b/);
	});

	it("two processes maintain order", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P1" },
			{ kind: "output", process: "P1", artifact: "B" },
			{ kind: "input", artifact: "B", process: "P2" },
			{ kind: "output", process: "P2", artifact: "C" },
		];
		expect(formatAsFlows(edges)).toBe("A >> P1 -> B\nB >> P2 -> C\n");
	});

	it("source process (no inputs) orders before processes that depend on its output", () => {
		// Q (rank 0, source) -> B (rank 1) -> P (rank 2) -> C (rank 3)
		// Also A (rank 0) -> P
		// sortedEdges: A>>P(rank 0,kind 0), Q->B(rank 0,kind 2), B>>P(rank 1,kind 0), P->C(rank 2,kind 2)
		// first-appearance order gives [P, Q] which is WRONG; rank order is [Q, P]
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "Q", artifact: "B" },
			{ kind: "input", artifact: "B", process: "P" },
			{ kind: "output", process: "P", artifact: "C" },
		];
		expect(formatAsFlows(edges)).toBe("Q -> B\n[A, B] >> P -> C\n");
	});

	it("isolated nodes after flows", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
		];
		expect(formatAsFlows(edges, ["lone"])).toBe("A >> P -> B\nlone\n");
	});
});
