# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

GitHub Issues。規約と採用手順は `.claude/skills/pfd-ops/references/github-issues-backend.md`（L3 プリセット）に従う。

## このリポのインスタンス値

- 一次情報: github.com/takasek/pfdsl/issues
- 同期監査スクリプト: `scripts/audit-issues-flow.mjs`（`--fix` で機械的修復）
- 監査対象: `.pfdsl/roadmap.pfdsl`

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- `.pfdsl/roadmap.pfdsl` — オープン issue の依存グラフ

## 自動生成 PR（ワークサイクル選択前に確認）

このリポでは issue close 時に `flow-on-issue-close.yml` が `flow-sync/*` ブランチで flow-sync PR を自動起票する。サイクル開始時に open のものがあればマージ先行。

## 終端ゲート追加項目（issue 固有）

**タイミング規約**: issue クローズと flow 確定は **PR マージ時**に行う（生態系図 merge_pr: 成果物・進捗・issue 更新はマージで正本になる）。PR 作成時点では行わない — PR がレビューで変わる/却下される可能性があるため。サイクルが PR 作成で終わる場合、下記2項目は「マージ時に実施」と記録して未了のまま閉じてよい。

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、**マージ時に**:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（定義は L3 reference。専属 process も含めて削除する）
- [ ] `packages/cli` を変更した場合、npm 公開（`v*` tag push）が必要か確認した（pending なら次サイクルの先頭タスクとして明記する — 忘れると `published_cli` が無期限に stale になる）
- [ ] `.pfdsl/roadmap.pfdsl` を変更した場合（issue クローズ・追加による flow-sync 含む）、`pnpm --filter @pfdsl/core exec vitest run -u` でスナップショットを更新しコミットした

「roadmap.pfdsl 変更 → snapshot 陳腐化」は 2026-06-19 の /pfd-retro で発見: PR #110 の flow-sync が roadmap.pfdsl を変更した際にスナップショットが更新されず、#108 として顕在化した。正しい更新コマンドは `-u` フラグ（`--update-snapshots` は vitest 1.x で無効）。

これら（npm 公開・snapshot 更新の各項目）は2026-06-16 の /pfd-retro で発見: #72/#74・#15/#77・#17/#81 の3PRが連続して impl_flow を更新せず、`@pfdsl/cli` の npm 公開も #74 以降止まっていた（main の package.json も npm 上も 0.0.4 のまま）。ルール（CLAUDE.md）はあったがゲートに写っていなかった。
