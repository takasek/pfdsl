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
	it("preserves visible adjacency through emphasis and link markup", () => {
		for (const [source, term] of [
			["com**mit**.", "commit"],
			["P**R**.", "PR"],
			["**P**R.", "PR"],
			["co*mm*it.", "commit"],
			["com[mit](https://example.com/branch).", "commit"],
			["P[**&#82;**][ref].\n\n[ref]: https://example.com/commit", "PR"],
			["ター**ン**。", "ターン"],
		]) {
			const found = report(source);
			assert.equal(found.length, 1, source);
			assert.deepEqual(found[0].terms, [term], source);
			assert.equal(found[0].column, source.indexOf("**") === 0 ? 3 : 1);
			assert.equal(found[0].text, source.split("\n\n")[0]);
		}
	});
	it("does not join text across excluded inline content", () => {
		for (const source of [
			"com`x`mit.",
			"P![image](x)R.",
			"com<!-- hidden -->mit.",
		]) {
			assert.deepEqual(report(source), [], source);
		}
	});
	it("keeps closing inline syntax with the sentence it belongs to", () => {
		const source = "[PR.](https://example.com) Next commit.";
		assert.deepEqual(
			report(source).map((f) => f.text),
			["[PR.](https://example.com)", "Next commit."],
		);
		assert.equal(report("**Ready.** Next commit.")[0].text, "Next commit.");
		assert.deepEqual(
			report("**PR. Next commit.**").map((f) => f.text),
			["**PR.", "Next commit.**"],
		);
	});
	it("scans decoded references while preserving source coordinates and sentence text", () => {
		const source =
			"# &#80;R checks\r\n\r\n😀 &amp; done&period; Review **P&#82;** and [comm&#x69;t](https://example.com/branch)&period;\r\nNext &#x30BF;&#x30FC;&#x30F3;。";
		const found = report(source);
		assert.equal(found.length, 3);
		assert.deepEqual(
			found.map((f) => f.terms),
			[["PR"], ["PR", "commit"], ["ターン"]],
		);
		assert.deepEqual(
			found.map((f) => [f.line, f.column]),
			[
				[1, 3],
				[3, source.split("\r\n")[2].indexOf("P&#82;") + 1],
				[4, 6],
			],
		);
		assert.equal(
			found[1].text,
			"Review **P&#82;** and [comm&#x69;t](https://example.com/branch)&period;",
		);
		assert.equal(found[2].text, "Next &#x30BF;&#x30FC;&#x30F3;。");
	});
	it("keeps escaped references literal and excludes encoded vocabulary in code and destinations", () => {
		assert.deepEqual(
			report(
				"\\&commat; P\\&#82; `&#80;R` [safe](https://example.com/&#80;R).\n\n```md\ncomm&#105;t\n```",
			),
			[],
		);
		const found = report("&NotEqualTilde; &#x1F600; \\* P&#82;.");
		assert.deepEqual(found[0].terms, ["PR"]);
		assert.equal(found[0].column, "&NotEqualTilde; &#x1F600; \\* ".length + 1);
		assert.equal(found[0].text, "&NotEqualTilde; &#x1F600; \\* P&#82;.");
		assert.equal(report("\\* P&#82;.")[0].text, "\\* P&#82;.");
	});
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
