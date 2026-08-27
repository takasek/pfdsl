import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");

const skill = read(".claude/skills/pfd-ops/SKILL.md");
const workCycle = read(".claude/skills/pfd-ops/references/work-cycle.md");
const retro = read(".claude/skills/pfd-retro/SKILL.md");
const retroCommand = read(".claude/commands/pfd-retro.md");
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

	it("keeps retrospective layers available without a roadmap", () => {
		assert.doesNotMatch(retro, /pfd-ops[^\n]+「前提条件」節/);
		assert.match(
			retro,
			/roadmap\.pfdsl[^\n]+存在しなくても[^\n]+A・B[^\n]+実行/,
		);
		assert.match(
			retro,
			/C 層[^\n]+監査対象のセッション[^\n]+D 層[^\n]+監査対象の知識成果物/,
		);
		assert.doesNotMatch(
			retro,
			/workflow\.pfdsl[^\n]+(?:C・D|C 層|D 層)[^\n]+実行/,
		);
		assert.match(retro, /roadmap[^\n]+固有[^\n]+非適用/);
		assert.doesNotMatch(
			retro,
			/roadmap(?:\.pfdsl)?[^\n]*(?:存在しない|scaffold)[^\n]*(?:pfd-retro 全体|A〜D)[^\n]*(?:非適用|実行しない|終了)/,
		);
		assert.match(retro, /未着手作業の発見[^\n]+採用済みの作業項目バックエンド/);
		assert.match(
			retro,
			/roadmap\.pfdsl[^\n]+採用している場合に限り[^\n]+依存チェーン/,
		);
		assert.match(
			retro,
			/作業項目バックエンドが存在しない[^\n]+ユーザーへの報告[^\n]+導入しない/,
		);
		assert.match(retro, /workflow\.md[^\n]+存在しない[^\n]+基本表/);
		assert.match(retroCommand, /A〜D[^\n]+適用対象[^\n]+実行/);
		assert.match(
			retro,
			/忘れ物 = 構造の欠落[^\n]+対応する採用済みの PFD[^\n]+存在する場合[^\n]+反映/,
		);
		assert.match(
			retro,
			/対応する採用済みの PFD[^\n]+存在しない場合[^\n]+ユーザーへの報告/,
		);
		assert.match(
			retro,
			/roadmap 管理対象[^\n]+作業項目[^\n]+登録済みか[^\n]+確認/,
		);
		assert.match(
			retro,
			/作業項目バックエンドを採用していない場合[^\n]+未追加スキャン[^\n]+非適用/,
		);
		assert.match(
			retro,
			/選択前の着手[^\n]+採用済みの作業項目バックエンド[^\n]+一次情報/,
		);
		assert.match(
			retro,
			/指定された宛先が存在しない場合[^\n]+ユーザーへの報告[^\n]+新設しない/,
		);
		assert.match(
			retro,
			/binding が存在しない場合[^\n]+パターン検索[^\n]+省略[^\n]+監査を継続/,
		);
		assert.doesNotMatch(retro, /gh issue list --state open/);
		assert.match(
			retro,
			/セッションログ[^\n]+作業記録[^\n]+番号[^\n]+gh issue view[^\n]+labels[^\n]+createdAt/,
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
