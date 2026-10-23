import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	findExecutorVocabulary,
	findRepoSpecificProse,
} from "./distributed-prose.mjs";

const report = (content) =>
	findExecutorVocabulary([{ path: "protocol.md", content }]);

describe("executor vocabulary report", () => {
	it("recognizes a pull request across Markdown soft wrapping", () => {
		const found = report("Intro. Open a pull\nrequest after review.");
		assert.equal(found.length, 1);
		assert.equal(found[0].line, 1);
		assert.equal(found[0].column, 15);
		assert.deepEqual(found[0].terms, ["pull\nrequest"]);
	});
	it("reports sentences and exact first-match coordinates across wrapped prose", () => {
		const found = report(
			"# Protocol\r\n\r\n😀 Ready. The **PR** must include\r\nthe commit. 次のターンで実行する。通常の状態。\r\n",
		);
		assert.equal(found.length, 2);
		assert.equal(found[0].line, 3);
		assert.equal(found[0].column, 17);
		assert.deepEqual(found[0].terms, ["PR", "commit"]);
		assert.equal(found[0].text, "The **PR** must include\r\nthe commit.");
		assert.deepEqual(found[1].terms, ["ターン"]);
		assert.equal(found[1].line, 4);
	});
	it("excludes parsed code, destinations, definitions and comments, retaining link labels", () => {
		const found = report(
			"`commit` and ``PR ` branch``.\n\n~~~text\nsubagent\n~~~\n\n    worktree\n\n<!-- TDD -->\n\n[状態](https://example.com/commit) and [PR][target].\n\n[target]: https://example.com/branch\n",
		);
		assert.equal(found.length, 1);
		assert.deepEqual(found[0].terms, ["PR"]);
	});
	it("covers English and Japanese vocabulary without substring or allowed-name hits", () => {
		assert.equal(
			report(
				"pfd-lens・pfd-cycle・pfd-retro。commitment, branchless, sprint, return.",
			).length,
			0,
		);
		for (const word of [
			"commits",
			"pull request",
			"PR",
			"branches",
			"worktrees",
			"subagent",
			"sub-agent",
			"TDD",
			"session",
			"turn",
			"コミット",
			"プルリクエスト",
			"ブランチ",
			"ワークツリー",
			"サブエージェント",
			"セッション",
			"ターン",
		]) {
			assert.equal(report(`${word} is required.`).length, 1, word);
		}
	});
	it("does not turn vocabulary observations into the existing failing rules", () => {
		assert.deepEqual(
			findRepoSpecificProse([
				{ path: "protocol.md", content: "Commit in the same PR." },
			]),
			[],
		);
	});
	it("reads the canonical work-cycle and reports its known completion timing sentence", () => {
		const content = readFileSync(
			new URL(
				"../harness-template/skills/pfd-ops/references/work-cycle.md",
				import.meta.url,
			),
			"utf8",
		);
		assert.ok(
			report(content).some((f) => f.text.includes("完了コミットと同時に")),
		);
	});
});
