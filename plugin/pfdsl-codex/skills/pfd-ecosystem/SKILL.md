---
name: pfd-ecosystem
summary: ecosystem bootstrap
description: |
  Use when bootstrapping or restructuring a project's PFD set (roadmap /
  workflow / pipeline) — initializing .pfdsl/ in a new repo, when
  .pfdsl/ is still scaffold, choosing which PFD kinds a project needs, or
  redesigning the kind structure. Interviews the user to pick needed kinds,
  prunes artifacts interactively, and grows the graphs. Prerequisite step
  before /pfd-cycle. The PFD kind taxonomy (ADR-0017: kind table, intake
  questions, one-file-per-kind rule) lives in references/kind-taxonomy.md.
---
<!-- DO NOT EDIT. Authoritative source: .claude/skills/pfd-ecosystem/SKILL.md. -->

# pfd-ecosystem: プロジェクト PFD セット対話的構築

roadmap / workflow / pipeline の3種別（ADR-0017）に基づき、 プロジェクトの `.pfdsl/` セットを scaffold から実際のグラフに育てる。
**いきなり全部書かない** — 問診で必要な種別を絞り、ユーザーと対話しながら剪定する。

## ステップ 0: pfdsl スキルを起動する

.pfdsl 記法の品質ガイドに従うため、まず `/pfdsl` スキルを invoke する。

## ステップ 1: リポジトリ全体像を把握する

次のものを読んでリポ全体の構造を掴む:

- ルートの `README.md`
- ディレクトリ構成（`ls` で主要ディレクトリを確認）
- `.pfdsl/roadmap.pfdsl`（存在する場合）— 大きい図は全文 Read せず `pfdsl graph summary <file>`（件数）・`graph io <file>`（外部入力・終端）でまず輪郭を掴む。再構築（restructuring）検討時は `graph stats <file> --limit <n>` で hub ノード（fan-in/fan-out 高）も確認する。`fan-in` / `fan-out` / `total` と順位は primary エッジのみを数え、還流は `feedback-in` / `feedback-out`（`--json` では `feedbackFanIn` / `feedbackFanOut`）に分けて出る。**還流込みの接続度で hub を探すときは `--limit` を付けない** — 切り落としは primary 順で起きるため、還流の多いノードほど窓の外に落ちる（実測では接続度上位20件のうち6件が `--limit 20` に入らない）

把握できたら、リポジトリの目的をひと言で要約してユーザーに提示する。

## ステップ 2: 必要な PFD 種別を問診する（対話）

種別の定義表・問診リスト・1種別1ファイル原則は `references/kind-taxonomy.md`（ADR-0017、**種別選定の一次情報** — pfd-ops はここを参照する）。問診リストでユーザーに確認し（YesならそのぶんPFDを作る）、Yes の種別のファイルだけを育てる。

## ステップ 3: 必要な種別のテンプレートをコピーする

ステップ 2 で Yes になった種別のテンプレートを `.pfdsl/` にコピーする。
テンプレートは pfd-ops スキルの `references/scaffold/` にある。所在はロード元で異なる（ADR-0028）:

- plugin 経由（通常）: `${PLUGIN_ROOT}/skills/pfd-ops/references/scaffold/`
- repo-local: `.agents/skills/pfd-ops/references/scaffold/`

どちらのロード元かの判定（`${PLUGIN_ROOT}` が置換されず変数名のまま見える場合の扱い）と、どちらも解決しない場合の3つ目の分岐は、pfd-ops SKILL.md「発火時の必須セルフチェック」の変数解決規則が一次情報 — ここには複製しない。

```
<scaffold>/roadmap.pfdsl
<scaffold>/roadmap.md
<scaffold>/workflow.pfdsl
<scaffold>/workflow.md
<scaffold>/pipeline.pfdsl
<scaffold>/pipeline.md
<scaffold>/bindings/pfd-retro.md
<scaffold>/bindings/pfd-retro-patterns/sample-pattern.md
<scaffold>/bindings/pfd-ops.md
<scaffold>/review-perspectives.md
```

必要な種別のファイルだけを `.pfdsl/` にコピーする（不要な種別はコピーしない）。
`bindings/pfd-retro.md`・`bindings/pfd-retro-patterns/`・`bindings/pfd-ops.md`・`review-perspectives.md` は種別と無関係（pfd-retro・pfd-ops スキルは全リポ共通で同梱される）— それぞれ `.pfdsl/bindings/pfd-retro.md`・`.pfdsl/bindings/pfd-retro-patterns/`・`.pfdsl/bindings/pfd-ops.md`・`.pfdsl/review-perspectives.md` として常にコピーする（`bindings/pfd-retro.md` がこのファイルを参照する）。
`bindings/pfd-retro-patterns/` は監査パターン本体の置き場で、`sample-pattern.md` は書式の見本 1 件のみを持つ（`bindings/pfd-retro.md` の「監査の新パターン」節が書き方を指す）。
既に `.pfdsl/` にファイルが存在する場合は上書きしない。
companion をどの言語で書くかは pfd-ops スキルの `references/architecture.md`「companion の記述言語」節に従う。

## ステップ 3.5: 作業項目バックエンド（L3）の採用・更新（任意）

作業項目の一次情報と同期手段を選ぶ。プリセットは2つある — GitHub Issues とファイルベース・トラッカー。どちらも任意で、採用しない場合は `roadmap.pfdsl` の依存構造管理のみで運用する。

**GitHub Issues を使う場合**は、リポ側自動化（GitHub Actions workflow・監査スクリプト）をリポルートへ実配置する:

```bash
node <pfd-ops skill root>/scripts/check-install-sync.mjs --deploy
```

`<pfd-ops skill root>` はステップ 3 と同じ規則で解決する（plugin: `${PLUGIN_ROOT}/skills/pfd-ops`、repo-local: `.agents/skills/pfd-ops`）。
既導入リポでは同じコマンドが refresh になる — ローカル編集されたファイルは上書きせず警告するので、編集を捨てて上書きする場合のみユーザーに確認して `--overwrite-local-edits` を付ける（編集を抱えた旧ファイルを編集ごと削除するのは別フラグ `--delete-edited-orphans`。編集の無い旧ファイルはフラグ無しで削除される）。
バックエンド規約の詳細は pfd-ops スキルの `references/github-issues-backend.md`。

**リポ内 markdown ファイルで管理する場合**は、リポルートへの実配置手順は無い（GitHub Actions を使わないため）。バックエンド規約の詳細は pfd-ops スキルの `references/file-based-tracker-backend.md`。

## ステップ 4: 種別ごとに対話しながら構築する

承認された種別について、1ファイルずつグラフを育てる。

**グラフが白紙からの初回構築なら、pfd-grill スキルの後ろ向き対話を推奨する。**
最終成果物から出発して producer とその入力を遡る導出は、白紙の図を埋める作業と非常に整合する。
その場合は `/pfd-grill` を invoke し、対象ファイルを渡して構築を進める（後ろ向き導出では全成果物が消費者を持つ形で生まれるため、終端監査は構築の中で自然に満たされる）。

前向きに列挙して構築する場合（既存グラフへの追記や、候補がすでに見えている場合）:

1. **主要な artifact と process の候補を列挙**してユーザーに提示する
2. **消費者を書けない成果物は載せない**（終端監査）— ユーザーと確認して剪定する
3. 承認されたノードで `>>`/`->` フローエッジを記述する
4. グラフで表現しきれない手続きは sibling `.md` companion に書く

前向き構築の途中でも、接続が素直に決まらないノードや曖昧さが残るノードには、pfd-grill の後ろ向き導出をそのノードに局所適用して解消する。
二者択一ではない — 前向きの列挙を既定の形としつつ、詰まった箇所ごとに grill で掘る。

いずれの経路でも pfdsl スキルの品質ガイドに従って記法を確認する。雛形のプレースホルダは実際のノード名に置き換える（プレースホルダのまま残さない）。

## ステップ 5: 検証とゲート

- 各 `.pfdsl` ファイルに対して `pfdsl check <file> --strict` が通ること
- **roadmap.pfdsl を採用している場合のみ**: 作成した `.pfdsl` のうち、他作業の着手をゲートする成果物を生むものだけ登録する（判定基準は pfd-ops の `references/work-cycle.md`「着手可能性と受け入れ」が一次情報 — ここには複製しない）。登録対象は `roadmap.pfdsl` に artifact として登録されているか確認し、未登録なら同 reference の「成果物の門番」に従って登録する。roadmap 未採用のリポではこの項目は N/A
