import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");

const skill = read(".claude/skills/pfd-ops/SKILL.md");
const workCycle = read(".claude/skills/pfd-ops/references/work-cycle.md");
// ADR-0039 keeps the Format 3 record contract in the adopting repo's binding,
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

	it("uses the format 3 decision-first contract without claiming semantic machine proof", () => {
		const format2Tokens =
			/提案:|前提を外した対案:|対案を採らない理由:|案の処分 N:/;
		const bindingMigrationHistory = opsBinding.split("**移行履歴**:")[1];
		const bindingMigrationHistorySection =
			bindingMigrationHistory?.split("\n\n## ")[0];

		assert.match(opsBinding, /設計記録形式: 3/);
		// The bundle must no longer teach the record format at all (ADR-0039).
		assert.doesNotMatch(workCycle, /設計記録形式: 3/);
		assert.ok(
			opsBinding.indexOf("決定:") < opsBinding.indexOf("理由:") &&
				opsBinding.indexOf("理由:") < opsBinding.indexOf("案の処分:") &&
				opsBinding.indexOf("案の処分:") < opsBinding.indexOf("前提検査 Pn:"),
		);
		assert.match(opsBinding, /元候補「<候補名>」/);
		assert.match(
			opsBinding,
			/記録の構造と.*時刻の妥当性・再承認参照を blocking にする/,
		);
		assert.match(
			opsBinding,
			/採用部分: <範囲>; 残部: <却下 \| 保留> — <理由または再検討条件>/,
		);
		assert.match(
			opsBinding,
			/改訂行を `-`、旧決定、`→`、新決定、`—`、変更理由、`— 再承認:`、再承認参照の順で書く/,
		);
		assert.match(opsBinding, /軸分割が実際の独立性を反映/);
		assert.match(opsBinding, /保留の再検討条件が実行可能/);
		assert.match(
			opsBinding,
			/表示種別.*ファイル変更.*外部書き込み.*認証情報.*費用発生.*権限を付与しない/,
		);
		assert.match(opsBinding, /optionCount.*完全性.*証明/);
		assert.match(opsBinding, /バックエンドの移行契約が選択する形式/);
		assert.match(
			opsBinding,
			/移行境界は各バックエンドの L3 reference が定める/,
		);
		// The bundle layer must carry none of the backend-specific record
		// vocabulary any more: neither the generic cycle nor the L3 preset.
		assert.doesNotMatch(workCycle, /issuecomment|canonical comment URL|対話 /);
		assert.doesNotMatch(
			githubBackend,
			/issuecomment|canonical comment URL|対話 /,
		);
		assert.doesNotMatch(workCycle, /2026-08-31T01:30:24Z/);
		assert.doesNotMatch(githubBackend, /2026-08-31T01:30:24Z/);
		assert.match(opsBinding, /以降の新規記録は完全な Format 3/);
		assert.match(opsBinding, /既存の有効な旧形式記録を書き換えない/);
		assert.match(opsBinding, /人間による意味的な再検査/);

		// ADR-0039: the bundle keeps only the placement contract; the format,
		// the canonical-URL grammar, the reapproval window and the migration
		// cutoffs are this repo's own rules and live in the binding.
		assert.match(opsBinding, /2026-08-30T09:32:50Z/);
		assert.match(opsBinding, /2026-08-31T01:30:24Z/);
		assert.match(opsBinding, /2026-09-05T14:07:16Z/);
		assert.match(opsBinding, /host.*owner.*repo/);
		assert.match(opsBinding, /YYYY-MM-DDTHH:MM:SS/);
		assert.match(opsBinding, /半角スペース/);
		assert.match(opsBinding, /comments.*pagination|pagination.*comments/);
		assert.match(opsBinding, /同じコメントを編集/);
		assert.match(opsBinding, /別コメント.*置換してはならない/);
		assert.match(opsBinding, /複数.*完全な形式3コメント.*fail-close/);
		assert.match(githubBackend, /コメントから正本を同定/);
		assert.match(
			githubBackend,
			/書式と再承認参照の検査は採用リポの binding が定める/,
		);
		assert.doesNotMatch(githubBackend, /設計記録形式: 3/);
		assert.ok(bindingMigrationHistorySection);
		assert.match(bindingMigrationHistorySection, format2Tokens);
		assert.doesNotMatch(
			opsBinding.replace(bindingMigrationHistorySection, ""),
			format2Tokens,
		);
		assert.doesNotMatch(githubBackend, format2Tokens);

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
		// The preset no longer names this repo's format history; it only says the
		// time-based legacy compatibility is the GitHub backend's alone.
		assert.match(
			fileBackend,
			/時刻による旧形式の互換性は GitHub Issues backend だけに適用する/,
		);
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
