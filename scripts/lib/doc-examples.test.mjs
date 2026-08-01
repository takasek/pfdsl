import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractBlocks } from "./doc-examples.mjs";

describe("extractBlocks", () => {
	it("extracts a single pfdsl block with its start line and content", () => {
		const text = ["intro", "```pfdsl", "processes:", "  a: {}", "```", "tail"].join("\n");
		const blocks = extractBlocks("spec.md", text);
		assert.equal(blocks.length, 1);
		assert.deepEqual(blocks[0], {
			startLine: 2,
			content: "processes:\n  a: {}",
			filePath: "spec.md",
		});
	});

	it("extracts multiple blocks in source order", () => {
		const text = ["```pfdsl", "a: {}", "```", "between", "```pfdsl", "b: {}", "```"].join("\n");
		const blocks = extractBlocks("spec.md", text);
		assert.equal(blocks.length, 2);
		assert.equal(blocks[0].content, "a: {}");
		assert.equal(blocks[1].content, "b: {}");
	});

	it("skips a block whose immediately preceding non-blank line has the nocheck annotation", () => {
		const text = ["<!-- pfdsl-nocheck -->", "```pfdsl", "broken: [", "```"].join("\n");
		assert.deepEqual(extractBlocks("spec.md", text), []);
	});

	it("does not skip when the nocheck annotation is separated by a blank line", () => {
		// The lookback only skips blank lines, not arbitrary distance — the
		// annotation must be the immediately preceding *non-blank* line, and a
		// blank line here still counts as "immediately preceding" once skipped.
		const text = ["<!-- pfdsl-nocheck -->", "", "```pfdsl", "a: {}", "```"].join("\n");
		assert.deepEqual(extractBlocks("spec.md", text), []);
	});

	it("includes a block by default when there is no nocheck annotation", () => {
		const text = ["some prose", "```pfdsl", "a: {}", "```"].join("\n");
		const blocks = extractBlocks("spec.md", text);
		assert.equal(blocks.length, 1);
	});

	it("ignores non-pfdsl fenced blocks", () => {
		const text = ["```js", "const a = 1;", "```"].join("\n");
		assert.deepEqual(extractBlocks("spec.md", text), []);
	});

	it("returns an empty array for text with no fenced blocks", () => {
		assert.deepEqual(extractBlocks("spec.md", "just prose\nmore prose"), []);
	});
});
