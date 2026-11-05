import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkFile, endsAtBoundary } from "./md-linebreaks.mjs";

describe("importing md-linebreaks.mjs has no side effect", () => {
	it("does not call process.exit merely by being imported", async () => {
		const originalExit = process.exit;
		let called = false;
		process.exit = () => {
			called = true;
		};
		try {
			// A fresh dynamic import with a cache-busting query would re-run any
			// top-level code; the static import above already proved this once,
			// but re-importing here keeps the assertion self-contained and
			// explicit, per #645's literal complaint about this script.
			await import("./md-linebreaks.mjs");
		} finally {
			process.exit = originalExit;
		}
		assert.equal(called, false);
	});
});

describe("endsAtBoundary", () => {
	it("treats an empty/blank line as at a boundary", () => {
		assert.equal(endsAtBoundary(""), true);
		assert.equal(endsAtBoundary("   "), true);
	});

	it("accepts Japanese sentence-ending punctuation", () => {
		for (const ch of ["。", "！", "？", "」", "』", "）", "…", "～"]) {
			assert.equal(
				endsAtBoundary(`text${ch}`),
				true,
				`expected "${ch}" to be a boundary`,
			);
		}
	});

	it("accepts English sentence-ending punctuation", () => {
		for (const ch of [".", "!", "?", ":", "*"]) {
			assert.equal(
				endsAtBoundary(`text${ch}`),
				true,
				`expected "${ch}" to be a boundary`,
			);
		}
	});

	it("accepts closing-bracket characters", () => {
		for (const ch of ["`", "]", ")", "}"]) {
			assert.equal(
				endsAtBoundary(`text${ch}`),
				true,
				`expected "${ch}" to be a boundary`,
			);
		}
	});

	it("does not treat a bare comma (、) as a boundary", () => {
		assert.equal(endsAtBoundary("text、"), false);
	});

	it("does not treat an ordinary word-ending letter as a boundary", () => {
		assert.equal(endsAtBoundary("plain text"), false);
	});

	it("ignores trailing whitespace before judging the boundary", () => {
		assert.equal(endsAtBoundary("text。   "), true);
	});
});

describe("checkFile", () => {
	// Fixtures open on a line that already ends at a boundary ("para。"): once
	// the check covers unindented lines too (#770), an opener that did not end
	// at one would itself be a violation and mask the break under test.
	it("flags an indented continuation whose previous line does not end at a boundary", () => {
		const text = ["para。", "続き", "  次の行"].join("\n");
		const violations = checkFile("a.md", text);
		assert.equal(violations.length, 1);
		assert.deepEqual(violations[0], {
			file: "a.md",
			line: 3,
			prev: "続き",
			cont: "次の行",
		});
	});

	it("does not flag a continuation whose previous line ends at a boundary", () => {
		const text = ["para。", "続き。", "  次の行"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips content inside a fenced code block", () => {
		// The fence opener must not be line 0 — the main loop starts at line
		// index 1 (line 0 is only ever checked for frontmatter), so a fence
		// opened on the very first line would never toggle `inFence`.
		const text = ["intro", "```", "続き", "  次の行", "```"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips content inside a ~~~ fenced code block", () => {
		const text = ["intro", "~~~", "続き", "  次の行", "~~~"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips YAML frontmatter", () => {
		const text = ["---", "title: 続き", "  x: 1", "---", "", "prose"].join(
			"\n",
		);
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips a continuation line that is itself a list marker", () => {
		const text = ["para。", "続き", "  - list item"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips a continuation preceded by a blank line", () => {
		const text = ["para。", "続き", "", "  次の行"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("flags a non-indented prose continuation whose previous line does not end at a boundary", () => {
		// #770: the indent requirement meant plain prose — the bulk of every
		// .md in this repo — was never checked at all, while the docstring and
		// CLAUDE.md both claimed prose was covered.
		const text = [
			"para。",
			"この文は語の途中で",
			"改行しているので違反。",
		].join("\n");
		const violations = checkFile("a.md", text);
		assert.equal(violations.length, 1);
		assert.deepEqual(violations[0], {
			file: "a.md",
			line: 3,
			prev: "この文は語の途中で",
			cont: "改行しているので違反。",
		});
	});

	it("skips the line following a heading", () => {
		// A heading never ends at a sentence boundary, so without this skip
		// every paragraph opening right under a heading would be a violation.
		const text = ["intro。", "## 見出し", "本文が始まる。"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips table rows on either side of the break", () => {
		const text = ["intro。", "| 列 | 列 |", "|---|---|", "| a | b |"].join(
			"\n",
		);
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips blockquote lines on either side of the break", () => {
		const text = ["intro。", "> 引用の一行目", "> 引用の二行目"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips raw HTML lines on either side of the break", () => {
		const text = ["intro。", "<details>", "<summary>x</summary>"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips a thematic break that is not blank-line separated", () => {
		const text = ["段落一。", "---", "次の段落。"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips a setext heading underline", () => {
		const text = ["intro。", "タイトル", "======", "本文が始まる。"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});
});
