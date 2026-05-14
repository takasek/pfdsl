import { describe, expect, it } from "vitest";
import { formatAsFlows, formatEdges } from "./formatter.js";
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

	it("multiple inputs → comma-separated", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "input", artifact: "B", process: "P" },
			{ kind: "output", process: "P", artifact: "C" },
		];
		expect(formatAsFlows(edges)).toBe("A, B >> P -> C\n");
	});

	it("multiple outputs → comma-separated", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
			{ kind: "output", process: "P", artifact: "C" },
		];
		expect(formatAsFlows(edges)).toBe("A >> P -> B, C\n");
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

	it("two processes maintain order", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P1" },
			{ kind: "output", process: "P1", artifact: "B" },
			{ kind: "input", artifact: "B", process: "P2" },
			{ kind: "output", process: "P2", artifact: "C" },
		];
		expect(formatAsFlows(edges)).toBe("A >> P1 -> B\nB >> P2 -> C\n");
	});

	it("isolated nodes after flows", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "A", process: "P" },
			{ kind: "output", process: "P", artifact: "B" },
		];
		expect(formatAsFlows(edges, ["lone"])).toBe("A >> P -> B\nlone\n");
	});
});
