import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findEntryPathHeadings } from "./entry-path-headings.mjs";

const at = (content, path = ".claude/skills/pfd-ops/SKILL.md") => [
	{ path, content },
];
const lines = (content) =>
	findEntryPathHeadings(at(content)).map((f) => f.line);

describe("findEntryPathHeadings", () => {
	it("flags a heading that names the command a section is reached by", () => {
		// A reader who did not arrive by that command reads the heading as a
		// section for someone else, and skips the procedure hanging under it.
		const found = findEntryPathHeadings(
			at("## ワークサイクル（/pfd-cycle の手順）\n"),
		);
		assert.equal(found.length, 1);
		assert.equal(found[0].line, 1);
		assert.equal(found[0].command, "/pfd-cycle");
		assert.equal(found[0].text, "## ワークサイクル（/pfd-cycle の手順）");
	});

	it("flags the command written inside inline code", () => {
		// Backticks are the normal way to write a command, so ignoring quoted
		// text would blind the check to its own subject.
		assert.deepEqual(lines("# ワークサイクル（`/pfd-cycle` の手順）\n"), [1]);
	});

	it("flags a two-character command, which is a command like any other", () => {
		assert.deepEqual(lines("## 起票（/qa の手順）\n"), [1]);
	});

	it("accepts a heading that names the procedure's content", () => {
		assert.deepEqual(
			lines("## ワークサイクル（選択・実行・終端ゲート・報告）\n"),
			[],
		);
	});

	it("ignores a command outside a heading", () => {
		// Body prose may cite the command as one route among others; only the
		// heading decides whether the section reads as out of scope.
		assert.deepEqual(lines("実行手順は `/spec-stress-test` が持つ\n"), []);
	});

	it("ignores a path segment in a heading, which names no command", () => {
		assert.deepEqual(
			lines("## L3 バックエンド（`references/github-issues-backend.md`）\n"),
			[],
		);
	});

	it("ignores a leading-slash path, which is not a command either", () => {
		assert.deepEqual(lines("## /usr/local/bin に置く場合\n"), []);
	});

	it("skips fenced blocks, whose headings are quoted material", () => {
		// A skill body quoting another document's heading is showing an example,
		// not naming its own section.
		assert.deepEqual(
			lines("```md\n## ワークサイクル（/pfd-cycle の手順）\n```\n"),
			[],
		);
	});

	it("reports every offending heading with its 1-based line number", () => {
		assert.deepEqual(
			lines(
				"# 導入\nprose\n### 監査（/pfd-retro の手順）\n## /pfd-init から始める\n",
			),
			[3, 4],
		);
	});

	it("returns nothing for an empty file set", () => {
		assert.deepEqual(findEntryPathHeadings([]), []);
	});
});
