import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	classifyBlock,
	computeRange,
	createBlockLocator,
} from "./spec-id-range.mjs";

describe("CommonMark block ownership", () => {
	it("ATX headings: a following paragraph starts without a blank line", () => {
		const text = "### Rule (SPEC_a)\nDescription (SPEC_b)";
		assert.deepEqual(computeRange(text, 2), { startLine: 2, endLine: 2 });
		const locate = createBlockLocator(text);
		assert.notEqual(locate(1), locate(2));
	});
	it("Fenced code blocks: a shorter fence cannot expose a heading boundary", () => {
		const text = "## Rule (SPEC_a)\n````\n```\n# x\n````\n## End";
		assert.deepEqual(computeRange(text, 1), { startLine: 1, endLine: 5 });
	});
	it("GFM tables: a definition row has its own range and classification", () => {
		const text = "| Rule | Value |\n| --- | --- |\n| (SPEC_a) | a |\n| b | c |";
		assert.deepEqual(computeRange(text, 3), { startLine: 3, endLine: 3 });
		assert.equal(classifyBlock(text.split("\n"), 2), "table-row");
	});
	it("List items: the second paragraph owns its definition", () => {
		const text = "- first\n\n  second (SPEC_a)\n  continuation\n- next";
		assert.deepEqual(computeRange(text, 3), { startLine: 3, endLine: 4 });
		assert.equal(classifyBlock(text.split("\n"), 2), "paragraph");
	});
	it("List items: continuation lines of the first paragraph belong to the item", () => {
		const text = "- first (SPEC_a)\n  continuation (SPEC_b)\n\n  second";
		const locate = createBlockLocator(text);
		assert.equal(locate(1), locate(2));
		assert.deepEqual(computeRange(text, 2), { startLine: 1, endLine: 4 });
	});
	it("Fenced code blocks and blank lines: no supported block gives a one-line fallback", () => {
		const text = "```\n# code\n```\n\nparagraph";
		const locate = createBlockLocator(text);
		assert.equal(locate(2), null);
		assert.equal(locate(4), null);
		assert.deepEqual(computeRange(text, 2), { startLine: 2, endLine: 2 });
		assert.equal(classifyBlock(text.split("\n"), 1), null);
	});
});

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
		const text = ["## A", "### A.1 (SPEC_a1)", "body", "## B", "body b"].join(
			"\n",
		);
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

	it("does not count the phantom line from a trailing newline as part of EOF", () => {
		const text = `${["## A (SPEC_a)", "body a", "more body"].join("\n")}\n`;
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 3 });
	});

	it("does not treat a fake heading inside a fenced code block as a boundary", () => {
		const text = ["## A (SPEC_a)", "```", "# fake heading", "```", "## B"].join(
			"\n",
		);
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 4 });
	});
});

describe("computeRange — table row", () => {
	it("spans exactly one line, regardless of marker position within it", () => {
		// GFM Tables: the delimiter row is what makes these lines a table.
		const text = ["| a | b |", "| --- | --- |", "| c | d (SPEC_t) |"].join(
			"\n",
		);
		const range = computeRange(text, 3);
		assert.deepEqual(range, { startLine: 3, endLine: 3 });
	});
	it("GFM Tables: pipe lines without a delimiter row are a paragraph", () => {
		const text = "| a | b (SPEC_t) |\n| c | d |";
		assert.deepEqual(computeRange(text, 1), { startLine: 1, endLine: 2 });
		assert.equal(classifyBlock(text.split("\n"), 0), "paragraph");
	});
});

describe("computeRange — list item", () => {
	it("ends at the next sibling item at the same indent", () => {
		const text = ["- item one (SPEC_i1)", "  continuation", "- item two"].join(
			"\n",
		);
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 2 });
	});

	it("includes a nested child list", () => {
		const text = [
			"- item one (SPEC_i1)",
			"  - child a",
			"  - child b",
			"- item two",
		].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 3 });
	});

	it("includes multiple continuation paragraphs inside the item", () => {
		const text = [
			"- item one (SPEC_i1)",
			"  first paragraph",
			"",
			"  second paragraph",
			"- item two",
		].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 4 });
	});

	it("includes a shallower line under CommonMark list item lazy continuation", () => {
		const text = [
			"  - item one (SPEC_i1)",
			"    body",
			"next paragraph, not a list item",
		].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 3 });
	});

	// CommonMark: List items (continuation indentation and laziness),
	// Thematic breaks, ATX headings (paragraph interruption), Fenced code blocks.
	for (const [name, text, line, endLine] of [
		[
			"ends before an unindented paragraph after a blank line",
			"- rule (SPEC_x)\n\nparagraph",
			1,
			1,
		],
		[
			"ends before a thematic break after a blank line",
			"- rule (SPEC_x)\n\n---",
			1,
			1,
		],
		["ends before an interrupting ATX heading", "- rule (SPEC_x)\n### H", 1, 1],
		[
			"excludes a paragraph indented less than the two-column content indent",
			"- rule (SPEC_x)\n\n paragraph",
			1,
			1,
		],
		[
			"includes unindented lazy continuation of a nested item",
			"- parent\n  - rule (SPEC_x)\ncontinuation",
			2,
			3,
		],
		[
			"includes an item fence containing heading-like text",
			"- rule (SPEC_x)\n  ```\n  # not a heading\n  ```\n\nparagraph",
			1,
			4,
		],
		[
			"chooses the deepest list item starting on the marker line",
			"- - rule (SPEC_x)\n  - sibling",
			1,
			1,
		],
	]) {
		it(`CommonMark: ${name}`, () => {
			assert.deepEqual(computeRange(text, line), { startLine: line, endLine });
		});
	}
	it("CommonMark List items: a non-one ordered marker continues the paragraph", () => {
		const text = "paragraph\n2. rule (SPEC_x)\ncontinuation";
		assert.deepEqual(computeRange(text, 2), { startLine: 1, endLine: 3 });
		assert.equal(classifyBlock(text.split("\n"), 1), "paragraph");
	});

	it("runs to EOF when there is no following sibling or dedent", () => {
		const text = ["- item one (SPEC_i1)", "  body a", "  body b"].join("\n");
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 3 });
	});

	it("does not count the phantom line from a trailing newline as part of EOF", () => {
		const text = `${["- item one (SPEC_i1)", "  body a", "  body b"].join("\n")}\n`;
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 3 });
	});

	it("finds the marker mid-line inside a list item", () => {
		const text = ["- item with (SPEC_mid) marker mid-line", "- item two"].join(
			"\n",
		);
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 1 });
	});
});

describe("computeRange — paragraph", () => {
	it("is bounded by blank lines on both sides", () => {
		const text = [
			"intro",
			"",
			"line one",
			"line two (SPEC_p)",
			"line three",
			"",
			"outro",
		].join("\n");
		const range = computeRange(text, 4);
		assert.deepEqual(range, { startLine: 3, endLine: 5 });
	});

	it("finds the marker mid-line, not just at line end", () => {
		const text = ["a paragraph with (SPEC_mid) marker in the middle."].join(
			"\n",
		);
		const range = computeRange(text, 1);
		assert.deepEqual(range, { startLine: 1, endLine: 1 });
	});
});
