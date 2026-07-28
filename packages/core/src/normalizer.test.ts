import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { normalize } from "./normalizer.js";
import { parseTokens } from "./parser.js";
import type { Frontmatter, NormalizedEdge } from "./types/index.js";

function edges(src: string, fm = null): NormalizedEdge[] {
	const { tokens } = lex(src);
	const { document } = parseTokens(tokens);
	return normalize(document, fm).edges;
}

function isolated(src: string, fm: Frontmatter | null = null): string[] {
	const { tokens } = lex(src);
	const { document } = parseTokens(tokens);
	return [...normalize(document, fm).isolatedNodes].sort();
}

describe("normalize", () => {
	it("chain A >> P -> B produces 2 edges", () => {
		const result = edges("A >> P -> B");
		expect(result).toHaveLength(2);
		expect(result).toContainEqual({
			kind: "input",
			artifact: "A",
			process: "P",
		});
		expect(result).toContainEqual({
			kind: "output",
			process: "P",
			artifact: "B",
		});
	});

	it("extended chain A >> P -> B >> Q -> C produces 4 edges", () => {
		const result = edges("A >> P -> B >> Q -> C");
		expect(result).toHaveLength(4);
		expect(result).toContainEqual({
			kind: "input",
			artifact: "A",
			process: "P",
		});
		expect(result).toContainEqual({
			kind: "output",
			process: "P",
			artifact: "B",
		});
		expect(result).toContainEqual({
			kind: "input",
			artifact: "B",
			process: "Q",
		});
		expect(result).toContainEqual({
			kind: "output",
			process: "Q",
			artifact: "C",
		});
	});

	it("set [a,b] >> P -> [x,y] produces 4 edges (Cartesian product)", () => {
		const result = edges("[a, b] >> P -> [x, y]");
		expect(result).toHaveLength(4);
		expect(result).toContainEqual({
			kind: "input",
			artifact: "a",
			process: "P",
		});
		expect(result).toContainEqual({
			kind: "input",
			artifact: "b",
			process: "P",
		});
		expect(result).toContainEqual({
			kind: "output",
			process: "P",
			artifact: "x",
		});
		expect(result).toContainEqual({
			kind: "output",
			process: "P",
			artifact: "y",
		});
	});

	it("feedback edge A >>? P produces feedback edge", () => {
		const result = edges("A >>? P");
		expect(result).toContainEqual({
			kind: "feedback",
			artifact: "A",
			process: "P",
		});
	});

	it("duplicate edge produces warning diagnostic", () => {
		const { tokens } = lex("A >> P\nA >> P");
		const { document } = parseTokens(tokens);
		const { diagnostics } = normalize(document, null);
		expect(
			diagnostics.some((d) => d.severity === "warning" && d.code === "N003"),
		).toBe(true);
	});

	it("type contradiction produces error diagnostic", () => {
		const { tokens } = lex("A >> P\nB >> A");
		const { document } = parseTokens(tokens);
		const { diagnostics } = normalize(document, null);
		expect(
			diagnostics.some((d) => d.severity === "error" && d.code === "N002"),
		).toBe(true);
	});

	it("front matter artifact declaration wins over the process role the body implies", () => {
		// Body position makes P a process; front matter declares it an artifact.
		// The declaration decides the kind, and the conflict is reported.
		const fm = { artifact: { P: { label: "Override" } } } as Frontmatter;
		const { tokens } = lex("A >> P");
		const { document } = parseTokens(tokens);
		const { diagnostics, nodeKinds } = normalize(document, fm);
		expect(nodeKinds.get("P")).toBe("artifact");
		expect(diagnostics.some((d) => d.code === "N002")).toBe(true);
	});

	it("nodeKinds: infers artifact and process kinds", () => {
		const { tokens } = lex("A >> P -> B");
		const { document } = parseTokens(tokens);
		const { nodeKinds } = normalize(document, null);
		expect(nodeKinds.get("A")).toBe("artifact");
		expect(nodeKinds.get("P")).toBe("process");
		expect(nodeKinds.get("B")).toBe("artifact");
	});

	it("N001: same ID declared as both artifact and process in front matter", () => {
		const fm = { artifact: { X: {} }, process: { X: {} } } as Frontmatter;
		const { tokens } = lex("");
		const { document } = parseTokens(tokens);
		const { diagnostics } = normalize(document, fm);
		expect(
			diagnostics.some((d) => d.severity === "error" && d.code === "N001"),
		).toBe(true);
	});

	it("front matter only: artifact-only ID registered as artifact even without body usage", () => {
		const fm = { artifact: { lonely: {} } } as Frontmatter;
		const { tokens } = lex("");
		const { document } = parseTokens(tokens);
		const { nodeKinds } = normalize(document, fm);
		expect(nodeKinds.get("lonely")).toBe("artifact");
	});

	it("front matter only: process-only ID registered as process even without body usage", () => {
		const fm = { process: { idle: {} } } as Frontmatter;
		const { tokens } = lex("");
		const { document } = parseTokens(tokens);
		const { nodeKinds } = normalize(document, fm);
		expect(nodeKinds.get("idle")).toBe("process");
	});

	it("node-decl: isolated artifact in isolatedNodes", () => {
		const { tokens } = lex("lonely");
		const { document } = parseTokens(tokens);
		const { nodeKinds, isolatedNodes, edges } = normalize(document, null);
		expect(edges).toHaveLength(0);
		expect(nodeKinds.get("lonely")).toBe("artifact");
		expect(isolatedNodes.has("lonely")).toBe(true);
	});

	it("node-decl: node that also appears in edge is not isolated", () => {
		const { tokens } = lex("A\nA >> P -> B");
		const { document } = parseTokens(tokens);
		const { isolatedNodes } = normalize(document, null);
		expect(isolatedNodes.has("A")).toBe(false);
		expect(isolatedNodes.has("P")).toBe(false);
		expect(isolatedNodes.has("B")).toBe(false);
	});

	it("front matter process without edges → isolated", () => {
		const fm = { process: { idle: {} } } as Frontmatter;
		const { tokens } = lex("");
		const { document } = parseTokens(tokens);
		const { isolatedNodes } = normalize(document, fm);
		expect(isolatedNodes.has("idle")).toBe(true);
	});
});

// A group takes part in no edge by design, so it must not be collected as an
// isolated node — otherwise `fmt` writes it into the body as a standalone
// declaration the user never typed. Nothing tested this (#637).
describe("isolated nodes", () => {
	it("collects an artifact declared only in frontmatter", () => {
		const fm = { artifact: { orphan: {} } } as unknown as Frontmatter;
		expect(isolated("A >> P -> B", fm)).toEqual(["orphan"]);
	});

	it("does not collect a group, which is not part of the edge graph", () => {
		const fm = {
			group: { backend: { label: "Backend" } },
		} as unknown as Frontmatter;
		expect(isolated("A >> P -> B", fm)).toEqual([]);
	});

	it("collects the artifacts but not the group when both are declared", () => {
		const fm = {
			group: { backend: {} },
			artifact: { orphan: {} },
		} as unknown as Frontmatter;
		expect(isolated("A >> P -> B", fm)).toEqual(["orphan"]);
	});

	it("does not collect a node that an edge already mentions", () => {
		const fm = { artifact: { A: { label: "A" } } } as unknown as Frontmatter;
		expect(isolated("A >> P -> B", fm)).toEqual([]);
	});
});
