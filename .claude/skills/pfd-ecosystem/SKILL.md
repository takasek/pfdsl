---
name: pfd-ecosystem
description: |
  Use when bootstrapping or restructuring a project's PFD set (roadmap /
  workflow / runtime-pipeline) — initializing .pfdsl/ in a new repo, when
  .pfdsl/ is still scaffold, choosing which PFD kinds a project needs, or
  redesigning the kind structure. Interviews the user to pick needed kinds,
  prunes artifacts interactively, and grows the graphs. Prerequisite step
  before /pfd-cycle. The PFD kind taxonomy (ADR-0017: kind table, intake
  questions, one-file-per-kind rule) lives in references/kind-taxonomy.md.
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

種別の定義表・問診リスト・1種別1ファイル原則は `references/kind-taxonomy.md`（ADR-0017、**種別選定の一次情報** — pfd-ops はここを参照する）。問診リストでユーザーに確認し（YesならそのぶんPFDを作る）、Yes の種別のファイルだけを育てる。

## ステップ 3: 必要な種別のテンプレートをコピーする

ステップ 2 で Yes になった種別のテンプレートを `.pfdsl/` にコピーする。
テンプレートは pfd-ops スキルの `references/scaffold/` にある。所在はロード元で異なる（ADR-0028）:

- plugin 経由（通常）: `${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops/references/scaffold/` — CLAUDE_PLUGIN_ROOT は plugin ロード時に実パスへ置換される変数（`${CLAUDE_PLUGIN_ROOT}` の形でのみ置換対象）。上のパスが置換されず変数名のまま見えている場合は plugin 外ロードなので次項のパスを使う
- repo-local: `.claude/skills/pfd-ops/references/scaffold/`

```
<scaffold>/roadmap.pfdsl
<scaffold>/roadmap.md
<scaffold>/workflow.pfdsl
<scaffold>/workflow.md
<scaffold>/runtime-pipeline.pfdsl
<scaffold>/runtime-pipeline.md
<scaffold>/bindings/pfd-retro.md
<scaffold>/bindings/pfd-ops.md
```

必要な種別のファイルだけを `.pfdsl/` にコピーする（不要な種別はコピーしない）。
`bindings/pfd-retro.md`・`bindings/pfd-ops.md` は種別と無関係（pfd-retro・pfd-ops スキルは全リポ共通で同梱される）— それぞれ `.pfdsl/bindings/pfd-retro.md`・`.pfdsl/bindings/pfd-ops.md` として常にコピーする。
既に `.pfdsl/` にファイルが存在する場合は上書きしない。

## ステップ 3.5: GitHub Issues バックエンド（L3）の採用・更新（任意）

作業項目を GitHub Issues で管理する場合、リポ側自動化（GitHub Actions workflow・監査スクリプト）をリポルートへ実配置する:

```bash
node <pfd-ops skill root>/scripts/check-install-sync.mjs --deploy
```

`<pfd-ops skill root>` はステップ 3 と同じ規則で解決する（plugin: `${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops`、repo-local: `.claude/skills/pfd-ops`）。
既導入リポでは同じコマンドが refresh になる — ローカル編集されたファイルは上書きせず警告するので、上書きする場合のみユーザーに確認して `--force` を付ける。
バックエンド規約の詳細は pfd-ops スキルの `references/github-issues-backend.md`。

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

- 各 `.pfdsl` ファイルに対して `npx @pfdsl/cli check <file>` が通ること
- **roadmap.pfdsl を採用している場合のみ**: 作成した `.pfdsl` が `roadmap.pfdsl` に artifact として登録されているか確認する（未登録なら pfd-ops スキルの「成果物の門番」に従って登録する）。roadmap 未採用のリポではこの項目は N/A
