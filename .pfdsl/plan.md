# plan.md — issue 管理バインディング（plan.pfdsl の companion）

`plan.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

GitHub Issues。規約と採用手順は pfd-ops スキルの `references/github-issues-backend.md`（L3 プリセット）に従う。

## このリポのインスタンス値

- 一次情報: github.com/takasek/pfdsl/issues
- 同期監査スクリプト: `scripts/audit-issues-flow.mjs`（`--fix` で機械的修復）
- 監査対象: `.pfdsl/plan.pfdsl`

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- `.pfdsl/plan.pfdsl` — オープン issue の依存グラフ
- `docs/pfdsl_implementation_flow.pfdsl` — ツールチェーン実装ロードマップ

## 終端ゲート追加項目（issue 固有、完了時に確認）

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（終端はチェーンごと削除、下流入力が残るものは `iN_` prefix を外す）
