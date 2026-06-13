# GitHub Issues バックエンド（pfd-ops プリセット）

PFD の作業項目を GitHub Issues で管理する流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。採用リポは `plan.md` でこのプリセットを指す。

## 規約

- **一次情報**: GitHub issue 本体。`plan.pfdsl` は依存構造のみ管理する
- **id 規約**: issue 対応 artifact の id は `iN_` prefix（N = issue 番号）。`iN_` id はオープン issue のみ参照する
- **ラベル**: 登録 issue は `flow:managed`、対象外は `flow:exempt`
- **updated_at**: 同期時点の GitHub `updatedAt` スナップショット
- **close 時の降格**: issue close 時は flow から削除する。終端はチェーンごと削除、下流入力が残るものは `iN_` prefix を外し一般 done artifact へ降格する

## 同期監査

`scripts/audit-issues-flow.mjs` が GitHub issues と `plan.pfdsl` の同期を機械監査する（ラベル・updatedAt・priority 突合）。`--fix` で機械的修復。

スクリプトは `resolve(__dirname, "..")` をリポルートとして `.pfdsl/plan.pfdsl` を解決するため、リポ `scripts/` 配下に置く。

## 採用手順

1. `scripts/audit-issues-flow.mjs` と `scripts/lib/`（`issues-flow-audit.mjs`, `yaml-require.mjs`）をリポ `scripts/` に設置する
2. GitHub に `flow:managed` / `flow:exempt` ラベルを作成する（`audit-issues-flow.mjs --fix` が未作成ラベルを自動生成する）
3. `plan.pfdsl` を依存構造のみのグラフとして用意し、issue artifact に `iN_` prefix を付ける
4. リポの `plan.md` で本プリセットを指し、スクリプト実パス・リポ URL を記載する
