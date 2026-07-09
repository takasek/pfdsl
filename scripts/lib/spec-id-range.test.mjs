import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyBlock, computeRange } from "./spec-id-range.mjs";

describe("classifyBlock", () => {
	it("classifies a heading line", () => {
		const lines = ["## Heading (SPEC_x)", "body"];
		assert.equal(classifyBlock(lines, 0), "heading");
	});

	it("classifies a paragraph line", () => {
		const lines = ["Just prose (SPEC_x)."];
		assert.equal(classifyBlock(lines, 0), "paragraph");
	});
});

describe("computeRange — heading", () => {
	it("runs to the next heading of the same level", () => {
		const text = ["## A (SPEC_a)", "body a", "## B", "body b"].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 2 });
	});

	it("runs to the next heading of a shallower level", () => {
		const text = ["## A", "### A.1 (SPEC_a1)", "body", "## B", "body b"].join("\n");
		const range = computeRange(text, 2);
		assert.deepEqual(range, { startLine: 2, endLine: 3 });
	});

	it("does not stop at a deeper heading", () => {
		const text = ["## A (SPEC_a)", "### A.1", "body", "## B"].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 3 });
	});

	it("runs to EOF when there is no following heading", () => {
		const text = ["## A (SPEC_a)", "body a", "more body"].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 3 });
	});

	it("does not treat a fake heading inside a fenced code block as a boundary", () => {
		const text = [
			"## A (SPEC_a)",
			"```",
			"# fake heading",
			"```",
			"## B",
		].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 4 });
	});
});

describe("computeRange — paragraph", () => {
	it("is bounded by blank lines on both sides", () => {
		const text = ["intro", "", "line one", "line two (SPEC_p)", "line three", "", "outro"].join(
			"\n",
		);
		const range = computeRange(text, 4);
		assert.deepEqual(range, { startLine: 3, endLine: 5 });
	});

	it("finds the marker mid-line, not just at line end", () => {
		const text = ["a paragraph with (SPEC_mid) marker in the middle."].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 1 });
	});
});
