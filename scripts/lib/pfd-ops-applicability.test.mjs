import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");

const skill = read(".claude/skills/pfd-ops/SKILL.md");
const workCycle = read(".claude/skills/pfd-ops/references/work-cycle.md");
// ADR-0039 keeps the design record contract in the adopting repo's binding,
// not in the distributed work cycle, so these assertions read the binding.
const opsBinding = read(".pfdsl/bindings/pfd-ops.md");
const retro = read(".claude/skills/pfd-retro/SKILL.md");
const githubBackend = read(
	".claude/skills/pfd-ops/references/github-issues-backend.md",
);
const fileBackend = read(
	".claude/skills/pfd-ops/references/file-based-tracker-backend.md",
);
const roadmapScaffold = read(
	".claude/skills/pfd-ops/references/scaffold/roadmap.md",
);

describe("pfd-ops applicability contract", () => {
	it("scopes the roadmap prerequisite to the work cycle", () => {
		assert.match(skill, /操作に対応する採用済み PFD/);
		assert.match(
			skill,
			/roadmap\.pfdsl[^\n]+存在しなくても[^\n]+workflow\.pfdsl/,
		);
		assert.doesNotMatch(skill, /本スキルは非適用/);
		assert.match(
			workCycle,
			/\.pfdsl\/roadmap\.pfdsl[^\n]+存在しない[^\n]+本ワークサイクルは非適用/,
		);
		assert.match(workCycle, /scaffold[^\n]+本ワークサイクルは非適用/);
		assert.doesNotMatch(
			skill,
			/bare issue or\s+work-item number[\s\S]+route it through the work cycle/,
		);
	});

	it("does not derive session-created items from the current open set", () => {
		const openIssueList = /gh\s+issue\s+list\b[^\n`]*--state(?:=|\s+)open\b/;
		assert.doesNotMatch(retro, openIssueList);

		const issueView = retro.match(
			/gh\s+issue\s+view\s+<number>\s+--json\s+([^\s`]+)/,
		);
		assert.ok(issueView);
		assert.deepEqual(
			new Set(issueView[1].split(",")),
			new Set(["number", "state", "labels", "createdAt"]),
		);
	});

	it("keeps the generic work cycle independent of the selected backend", () => {
		assert.match(opsBinding, /一次記録と設計判断履歴/);
		assert.match(opsBinding, /記録を確定/);
		assert.match(workCycle, /L3 が完了契約を定義する場合/);
		assert.doesNotMatch(
			workCycle,
			/gh issue view|作業項目の本文とコメント|作業項目コメント|コメントの投稿時刻|作業項目を閉じるキーワード|デフォルトブランチへ直接マージ|中間 PR|完了キーワード|免除宣言/,
		);
	});

	it("assigns record and reapproval evidence without requiring commit chronology", () => {
		assert.match(githubBackend, /本文とコメント/);
		assert.match(opsBinding, /投稿・編集時刻と初コミットの比較は行わない/);
		assert.match(fileBackend, /当該項目に追記/);
		assert.match(
			fileBackend,
			/参照先の実在・本文の意味・各改訂行との対応は人間レビューが確認する/,
		);
		assert.match(fileBackend, /完了契約/);
		assert.match(fileBackend, /一次情報[^\n]+status[^\n]+完了/);
		assert.match(fileBackend, /終端ゲート/);
	});

	it("makes roadmap adoption distinct from other GitHub Issues usage", () => {
		assert.match(roadmapScaffold, /roadmap の作業項目バックエンドとしての採否/);
		assert.match(roadmapScaffold, /roadmap 管理外/);
	});

	it("keeps placement and readback distributed while record policy belongs to the binding", () => {
		const format2Tokens =
			/提案:|前提を外した対案:|対案を採らない理由:|案の処分 N:/;
		assert.match(githubBackend, /コメントから正本を同定/);
		assert.match(githubBackend, /exact-write readback/);
		assert.match(
			githubBackend,
			/書式と再承認参照の検査は採用リポの binding が定める/,
		);
		assert.doesNotMatch(
			workCycle,
			/設計記録形式: 3|issuecomment|canonical comment URL/,
		);
		assert.doesNotMatch(
			githubBackend,
			/設計記録形式: 3|canonical comment URL|2026-08-31T01:30:24Z/,
		);

		// ADR-0039: the L3 preset delegates the record format to the adopting
		// repo's binding instead of declaring it itself — and, with the format
		// gone from the bundle, must not require a record the binding has not
		// defined, or an adopting repo is told to invent one.
		assert.match(
			fileBackend,
			/書式・再承認参照の検査は採用リポの binding が定める/,
		);
		assert.match(
			fileBackend,
			/binding がそれを定めていなければ、このプリセットは記録を要求しない/,
		);
		assert.doesNotMatch(fileBackend, /設計記録形式: 3/);
		// The declaration token leaving is not enough: the preset must not require
		// a format by name either, or an adopting repo is told to use one whose
		// definition the bundle no longer carries.
		assert.doesNotMatch(fileBackend, /Format 3/);
		assert.doesNotMatch(githubBackend, /Format 3 は/);
		assert.match(fileBackend, /当該項目に追記/);
		assert.match(fileBackend, /実装の初コミットとの順序は判定しない/);
		assert.doesNotMatch(fileBackend, /投稿時刻|コメント.*編集|createdAt/);
		// Legacy-format cutoffs are this repo's binding's (ADR-0039 category iii);
		// neither preset defines one, so the file preset must not point at one.
		assert.doesNotMatch(fileBackend, /旧形式/);
		assert.doesNotMatch(githubBackend, /旧形式/);
		assert.doesNotMatch(fileBackend, /形式2/);
		assert.doesNotMatch(fileBackend, format2Tokens);
		// The reapproval reference's grammar, what counts as approval evidence,
		// and the commit split that produces it are discipline the backend fact
		// does not imply, so they belong to the adopting repo (ADR-0039 category
		// iii). The preset keeps only the fact that a commit SHA can name a
		// version here.
		assert.match(
			fileBackend,
			/再承認参照の文法と、何を承認証跡とするかは採用リポの binding が定める/,
		);
		assert.doesNotMatch(fileBackend, /コミット <40桁SHA>/);
		assert.doesNotMatch(fileBackend, /承認履歴:/);
		assert.doesNotMatch(fileBackend, /40桁の16進 SHA/);
		assert.match(fileBackend, /解決器が無い/);
		assert.doesNotMatch(fileBackend, /機械.*検証/);
	});
});
