import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");

const skill = read(".claude/skills/pfd-ops/SKILL.md");
const workCycle = read(".claude/skills/pfd-ops/references/work-cycle.md");
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

	it("uses the format 3 decision-first contract without claiming semantic machine proof", () => {
		const format2Tokens =
			/提案:|前提を外した対案:|対案を採らない理由:|案の処分 N:/;
		const githubMigrationHistory = githubBackend.split("**移行履歴**:")[1];
		const githubMigrationHistorySection =
			githubMigrationHistory?.split("\n\n## ")[0];

		assert.match(workCycle, /設計記録形式: 3/);
		assert.ok(
			workCycle.indexOf("決定:") < workCycle.indexOf("理由:") &&
				workCycle.indexOf("理由:") < workCycle.indexOf("案の処分:") &&
				workCycle.indexOf("案の処分:") < workCycle.indexOf("前提検査 Pn:"),
		);
		assert.match(workCycle, /元候補「<候補名>」/);
		assert.match(workCycle, /機械検査は構造だけを blocking にする/);
		assert.match(
			workCycle,
			/採用部分: <範囲>; 残部: <却下 \| 保留> — <理由または再検討条件>/,
		);
		assert.match(
			workCycle,
			/- <旧決定> → <新決定> — <変更理由> — 再承認: <URL>/,
		);
		assert.match(workCycle, /軸分割が実際の独立性を反映/);
		assert.match(workCycle, /保留の再検討条件が実行可能/);
		assert.match(
			workCycle,
			/表示種別.*ファイル変更.*外部書き込み.*認証情報.*費用発生.*権限を付与しない/,
		);
		assert.match(workCycle, /optionCount.*完全性.*証明/);
		assert.doesNotMatch(workCycle, format2Tokens);
		assert.match(workCycle, /バックエンドの移行契約が選択する形式/);
		assert.match(workCycle, /2026-08-31T01:30:24Z/);
		assert.match(workCycle, /以降の新規記録は完全な Format 3/);
		assert.match(workCycle, /既存の有効な旧形式記録を書き換えない/);
		assert.match(workCycle, /人間による意味的な再検査/);

		assert.match(githubBackend, /2026-08-30T09:32:50Z/);
		assert.match(githubBackend, /2026-08-31T01:30:24Z/);
		assert.match(githubBackend, /設計記録形式: 3/);
		assert.match(githubBackend, /同じコメントを編集/);
		assert.match(githubBackend, /別コメント.*置換してはならない/);
		assert.match(githubBackend, /複数.*完全な形式3コメント.*fail-close/);
		assert.ok(githubMigrationHistorySection);
		assert.match(githubMigrationHistorySection, format2Tokens);
		assert.doesNotMatch(
			githubBackend.replace(githubMigrationHistorySection, ""),
			format2Tokens,
		);

		assert.match(fileBackend, /設計記録形式: 3/);
		assert.match(fileBackend, /当該項目に追記/);
		assert.match(fileBackend, /コミット順/);
		assert.doesNotMatch(fileBackend, /投稿時刻|コメント.*編集|createdAt/);
		assert.match(fileBackend, /移行履歴.*形式2/);
		assert.doesNotMatch(fileBackend, format2Tokens);
	});
});
