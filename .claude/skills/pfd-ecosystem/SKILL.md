---
name: pfd-ecosystem
description: |
  対話的にプロジェクトの PFD セット（roadmap / workflow / runtime-pipeline）を
  初期構築または整理するスキル。.pfdsl/ が scaffold のまま、または PFD 全体を
  見直したいときに使う。問診で必要な種別を特定し、ユーザーと確認しながら
  成果物を剪定し、グラフを育てる。/pfd-cycle の前提条件が揃っていない
  新規リポや、種別設計を一から見直したいときに起動する。
---

# pfd-ecosystem: プロジェクト PFD セット対話的構築

roadmap / workflow / runtime-pipeline の3種別（ADR-0017）に基づき、
プロジェクトの `.pfdsl/` セットを scaffold から実際のグラフに育てる。
**いきなり全部書かない** — 問診で必要な種別を絞り、ユーザーと対話しながら剪定する。

## ステップ 0: pfdsl スキルを起動する

.pfdsl 記法の品質ガイドに従うため、まず `/pfdsl` スキルを invoke する。

## ステップ 1: リポジトリ全体像を把握する

次のものを読んでリポ全体の構造を掴む:

- ルートの `README.md`
- ディレクトリ構成（`ls` で主要ディレクトリを確認）
- `.pfdsl/roadmap.pfdsl`（存在する場合）

把握できたら、リポジトリの目的をひと言で要約してユーザーに提示する。

## ステップ 2: 必要な PFD 種別を問診する（対話）

以下の問診リストでユーザーに確認する:

| 問い | 種別 |
|---|---|
| 実装すべき作業に依存関係があり、着手順を管理したいか？ | roadmap |
| 定常的に繰り返す作業サイクルがあるか？ | workflow |
| システムがデータを受け取り変換して出力するパイプラインがあるか？ | runtime-pipeline |

Yes の種別のファイルだけを育てる。

## ステップ 3: 必要な種別のテンプレートをコピーする

ステップ 2 で Yes になった種別のテンプレートを `.pfdsl/` にコピーする。
テンプレートは `skill sync pfd-ops` 実行後に以下のパスに配置されている:

```
.claude/skills/pfd-ops/references/scaffold/roadmap.pfdsl
.claude/skills/pfd-ops/references/scaffold/roadmap.md
.claude/skills/pfd-ops/references/scaffold/workflow.pfdsl
.claude/skills/pfd-ops/references/scaffold/workflow.md
.claude/skills/pfd-ops/references/scaffold/runtime-pipeline.pfdsl
.claude/skills/pfd-ops/references/scaffold/runtime-pipeline.md
```

必要な種別のファイルだけを `.pfdsl/` にコピーする（不要な種別はコピーしない）。
既に `.pfdsl/` にファイルが存在する場合は上書きしない。

## ステップ 4: 種別ごとに対話しながら構築する

承認された種別について、1ファイルずつ:

1. **主要な artifact と process の候補を列挙**してユーザーに提示する
2. **消費者を書けない成果物は載せない**（終端監査）— ユーザーと確認して剪定する
3. 承認されたノードで `>>`/`->` フローエッジを記述する
4. グラフで表現しきれない手続きは sibling `.md` companion に書く

pfdsl スキルの品質ガイドに従って記法を確認する。雛形のプレースホルダは実際のノード名に置き換える（プレースホルダのまま残さない）。

## ステップ 5: 検証とゲート

- 各 `.pfdsl` ファイルに対して `pfdsl check <file>` が通ること
- 作成した `.pfdsl` が `roadmap.pfdsl` に artifact として登録されているか確認する（未登録なら pfd-ops スキルの「成果物の門番」に従って登録する）
