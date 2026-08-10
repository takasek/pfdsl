import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { locateNode } from "./locate.js";
import type { NodeKind } from "./types/index.js";

describe("locateNode", () => {
	/**
	 * Stands in for the CLI call sites: they reach locateNode through their own
	 * analyze(), so the document and the node's kind are already in hand. `kind`
	 * is passed explicitly for the cases where the id isn't in the file at all.
	 */
	const locate = (source: string, id: string, kind?: NodeKind) => {
		const { document, nodeKinds } = analyze(source);
		return locateNode(document, source, id, kind ?? nodeKinds.get(id)!);
	};

	const src = `---
artifact:
  req:
    label: Req
  spec:
    label: Spec
process:
  design:
    label: Design
---
req >> design -> spec
`;

	it("finds an artifact's frontmatter declaration line", () => {
		expect(locate(src, "req").declarationLine).toBe(3);
	});

	it("finds a second artifact's frontmatter declaration line", () => {
		expect(locate(src, "spec").declarationLine).toBe(5);
	});

	it("finds a process's frontmatter declaration line", () => {
		expect(locate(src, "design").declarationLine).toBe(8);
	});

	it("collects the body line where a node appears in an edge", () => {
		expect(locate(src, "req").edgeLines).toEqual([11]);
		expect(locate(src, "design").edgeLines).toEqual([11]);
		expect(locate(src, "spec").edgeLines).toEqual([11]);
	});

	it("finds a group's frontmatter declaration line, with no edge lines (groups don't appear in edges)", () => {
		const withGroup = `---
group:
  g1:
    label: G1
artifact:
  a:
    group: g1
---
x -> a
`;
		const result = locate(withGroup, "g1");
		expect(result.declarationLine).toBe(3);
		expect(result.edgeLines).toEqual([]);
	});

	it("collects one edge line per distinct statement the id appears in", () => {
		const multi = `r >> p1 -> a
a >> p2 -> b
`;
		expect(locate(multi, "a").edgeLines).toEqual([1, 2]);
	});

	it("dedupes multiple occurrences of the same id on the same line", () => {
		const dup = `[a, a] >> p -> b\n`;
		expect(locate(dup, "a").edgeLines).toEqual([1]);
	});

	it("returns declarationLine: null and edgeLines: [] for an id that doesn't exist", () => {
		const result = locate(src, "nonexistent", "artifact");
		expect(result.declarationLine).toBeNull();
		expect(result.edgeLines).toEqual([]);
	});

	it("returns null declarationLine for a node that only appears in the body (no frontmatter entry)", () => {
		const bodyOnly = "r >> p -> a\n";
		const result = locate(bodyOnly, "r");
		expect(result.declarationLine).toBeNull();
		expect(result.edgeLines).toEqual([1]);
	});

	it("keeps line numbers correct on a CRLF file", () => {
		const crlf = src.replace(/\n/g, "\r\n");
		expect(locate(crlf, "design").declarationLine).toBe(8);
		expect(locate(crlf, "spec").edgeLines).toEqual([11]);
	});

	it("finds a node-decl (isolated node) occurrence as an edge line", () => {
		const withIsolated = `iso\nr >> p -> a\n`;
		expect(locate(withIsolated, "iso").edgeLines).toEqual([1]);
	});
});
