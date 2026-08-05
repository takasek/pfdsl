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
	it("flags an indented continuation whose previous line does not end at a boundary", () => {
		const text = ["para", "続き", "  次の行"].join("\n");
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
		const text = ["para", "続き。", "  次の行"].join("\n");
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
		const text = ["---", "title: 続き", "  x: 1", "---", "prose"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips a continuation line that is itself a list marker", () => {
		const text = ["para", "続き", "  - list item"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("skips a continuation preceded by a blank line", () => {
		const text = ["para", "続き", "", "  次の行"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});

	it("ignores a non-indented line even if it follows a non-boundary line", () => {
		const text = ["para", "続き", "次の行without indent"].join("\n");
		assert.deepEqual(checkFile("a.md", text), []);
	});
});
