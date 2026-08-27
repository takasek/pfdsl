import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");

const skill = read(".claude/skills/pfd-ops/SKILL.md");
const workCycle = read(".claude/skills/pfd-ops/references/work-cycle.md");
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
	it("leaves ordinary issue work alone when the repository has not adopted PFDs", () => {
		assert.match(skill, /\.pfdsl\/roadmap\.pfdsl[^\n]+存在しない[^\n]+非適用/);
		assert.match(skill, /scaffold[^\n]+非適用/);
		assert.match(skill, /明示的に PFD の導入[^\n]+依頼/);
		assert.doesNotMatch(skill, /scaffold[^\n]+依頼かを確認/);
		assert.doesNotMatch(
			skill,
			/bare issue or\s+work-item number[\s\S]+route it through the work cycle/,
		);
	});

	it("keeps the generic work cycle independent of the selected backend", () => {
		assert.match(workCycle, /一次記録と設計判断履歴/);
		assert.match(workCycle, /記録を確定/);
		assert.match(workCycle, /L3 が完了契約を定義する場合/);
		assert.doesNotMatch(
			workCycle,
			/gh issue view|作業項目の本文とコメント|作業項目コメント|コメントの投稿時刻|作業項目を閉じるキーワード|デフォルトブランチへ直接マージ|中間 PR|完了キーワード|免除宣言/,
		);
	});

	it("assigns concrete record and ordering evidence to each backend", () => {
		assert.match(githubBackend, /本文とコメント/);
		assert.match(githubBackend, /投稿時刻/);
		assert.match(fileBackend, /当該項目に追記/);
		assert.match(fileBackend, /コミット順/);
		assert.match(fileBackend, /完了契約/);
		assert.match(fileBackend, /一次情報[^\n]+status[^\n]+完了/);
		assert.match(fileBackend, /終端ゲート/);
	});

	it("makes roadmap adoption distinct from other GitHub Issues usage", () => {
		assert.match(roadmapScaffold, /roadmap の作業項目バックエンドとしての採否/);
		assert.match(roadmapScaffold, /roadmap 管理外/);
	});
});
