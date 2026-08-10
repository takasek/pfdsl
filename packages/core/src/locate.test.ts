import { describe, expect, it } from "vitest";
import { locateNode } from "./locate.js";

describe("locateNode", () => {
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
		expect(locateNode(src, "req").declarationLine).toBe(3);
	});

	it("finds a second artifact's frontmatter declaration line", () => {
		expect(locateNode(src, "spec").declarationLine).toBe(5);
	});

	it("finds a process's frontmatter declaration line", () => {
		expect(locateNode(src, "design").declarationLine).toBe(8);
	});

	it("collects the body line where a node appears in an edge", () => {
		expect(locateNode(src, "req").edgeLines).toEqual([11]);
		expect(locateNode(src, "design").edgeLines).toEqual([11]);
		expect(locateNode(src, "spec").edgeLines).toEqual([11]);
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
		const result = locateNode(withGroup, "g1");
		expect(result.declarationLine).toBe(3);
		expect(result.edgeLines).toEqual([]);
	});

	it("collects one edge line per distinct statement the id appears in", () => {
		const multi = `r >> p1 -> a
a >> p2 -> b
`;
		expect(locateNode(multi, "a").edgeLines).toEqual([1, 2]);
	});

	it("dedupes multiple occurrences of the same id on the same line", () => {
		const dup = `[a, a] >> p -> b\n`;
		expect(locateNode(dup, "a").edgeLines).toEqual([1]);
	});

	it("returns declarationLine: null and edgeLines: [] for an id that doesn't exist", () => {
		const result = locateNode(src, "nonexistent");
		expect(result.declarationLine).toBeNull();
		expect(result.edgeLines).toEqual([]);
	});

	it("returns null declarationLine for a node that only appears in the body (no frontmatter entry)", () => {
		const bodyOnly = "r >> p -> a\n";
		const result = locateNode(bodyOnly, "r");
		expect(result.declarationLine).toBeNull();
		expect(result.edgeLines).toEqual([1]);
	});

	it("keeps line numbers correct on a CRLF file", () => {
		const crlf = src.replace(/\n/g, "\r\n");
		expect(locateNode(crlf, "design").declarationLine).toBe(8);
		expect(locateNode(crlf, "spec").edgeLines).toEqual([11]);
	});

	it("finds a node-decl (isolated node) occurrence as an edge line", () => {
		const withIsolated = `iso\nr >> p -> a\n`;
		expect(locateNode(withIsolated, "iso").edgeLines).toEqual([1]);
	});
});
