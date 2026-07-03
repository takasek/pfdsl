---
name: pfd-ecosystem
description: |
  Use when bootstrapping or restructuring a project's PFD set (roadmap /
  workflow / runtime-pipeline) — initializing .pfdsl/ in a new repo, when
  .pfdsl/ is still scaffold, choosing which PFD kinds a project needs, or
  redesigning the kind structure. Interviews the user to pick needed kinds,
  prunes artifacts interactively, and grows the graphs. Prerequisite step
  before /pfd-cycle. Also the primary source for the PFD kind taxonomy
  (ADR-0017: kind table, intake questions, one-file-per-kind rule).
---

# pfd-ecosystem: プロジェクト PFD セット対話的構築

roadmap / workflow / runtime-pipeline の3種別（ADR-0017）に基づき、 プロジェクトの `.pfdsl/` セットを scaffold から実際のグラフに育てる。
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

種別は「このPFDが答える問い」で区別する（ADR-0017）。**この節が種別選定の一次情報**（pfd-ops はここを参照する）。

| 種別 | 答える問い | statusを使うか |
|---|---|---|
| **roadmap** | 何を何の前に作る必要があるか。今着手できる作業はどれか | 使う（todo→wip→done） |
| **workflow** | この作業はどう繰り返されるか。誰が何をトリガーに何を行うか | 通常書かない |
| **runtime-pipeline** | システムが動くとき、データは何に変換されるか。変換の境界はどこか | 通常書かない |

以下の問診リストでユーザーに確認する（YesならそのぶんPFDを作る）:

| 問い | 種別 |
|---|---|
| 実装すべき作業に依存関係があり、着手順を管理したいか？ | roadmap |
| 定常的に繰り返す作業サイクルがあるか？ | workflow |
| システムがデータを受け取り変換して出力するパイプラインがあるか？ | runtime-pipeline |

workflow か runtime-pipeline か迷ったら: 人・チームの判断やトリガーが主役 → workflow / データの変換経路が主役 → runtime-pipeline。同一ドメインに両方存在してよい。

**1種別1ファイルを原則とする。** 同一種別内の細分はgroupで行う。同一種別を複数ファイルに分ける動機（読み手が完全に別・ファイルが実用上の限界を超えるなど）がない限り分割しない。

Yes の種別のファイルだけを育てる。

## ステップ 3: 必要な種別のテンプレートをコピーする

ステップ 2 で Yes になった種別のテンプレートを `.pfdsl/` にコピーする。
テンプレートは `skill sync` 実行後に以下のパスに配置されている:

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
- **roadmap.pfdsl を採用している場合のみ**: 作成した `.pfdsl` が `roadmap.pfdsl` に artifact として登録されているか確認する（未登録なら pfd-ops スキルの「成果物の門番」に従って登録する）。roadmap 未採用のリポではこの項目は N/A
