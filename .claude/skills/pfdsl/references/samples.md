<!-- DO NOT EDIT — generated from docs/samples/ in https://github.com/takasek/pfdsl -->

# PFDSL Samples Reference

Annotated .pfdsl files illustrating each language feature.

## 01-simple-chain — Simple chain

`>>` (artifact→process) and `->` (process→artifact).

```pfdsl
requirements >> design -> spec
```

---

## 02-feedback — Feedback edge

`>>?` renders as a dashed edge with `constraint=false` — does not affect rank.

```pfdsl
spec >> implement -> code
code >> verify -> bug_report
bug_report >>? implement
```

---

## 03-set-input — Set input

`[A, B] >> P` expands to two input edges.

```pfdsl
[schema, seed_data] >> migrate -> database
```

---

## 04-set-output — Set output

`P -> [A, B]` expands to two output edges.

```pfdsl
source >> build -> [binary, docs]
```

---

## 05-label-cjk — Label + CJK

`label:` sets the display name shown below the node ID. CJK labels get a computed `width=` to prevent clipping in the wasm renderer.

```pfdsl
---
artifact:
  D1: { label: 紙のアンケート }
  D2: { label: デジタルアンケート }
process:
  P1: { label: スキャン }
---
D1 >> P1 -> D2
```

---

## 06-status-styles — Status & tag styles

`status:` + `tags:` on artifacts/processes; `statusStyles:` and the `tag:` block (label / description / style) apply DOT attributes. Multiple tags merge; `status` wins conflicts.

```pfdsl
---
artifact:
  raw_data:  { tags: [external, sensitive] }
  spec:      { status: wip }
  processed: { status: done, tags: [external] }
  report:    { status: todo, tags: [external] }
statusStyles:
  done: { fillcolor: "#d4edda", style: filled }
  wip:  { fillcolor: "#fff3cd", style: filled }
  todo: { fillcolor: "#f8f9fa", style: filled }
tag:
  external:
    label: Publicly Released
    description: Artifacts published or delivered externally
    style: { color: "#0066cc", penwidth: "2" }
  sensitive:
    style: { style: dashed }
---
raw_data >> ingest -> processed
spec >> analyze -> report
processed >> analyze
```

---

## 08-groups — Groups

`group:` on nodes + `group:` declarations produce `subgraph cluster_<id>` blocks.

```pfdsl
---
group:
  frontend: { label: Frontend, color: lightblue }
  backend:  { label: Backend,  color: lightyellow }
  db:       { label: DB Layer, color: "#ffd9b3", parent: backend }
artifact:
  schema:    { group: db }
  migrated:  { group: db }
  endpoint:  { group: backend }
  ui_mockup: { group: frontend }
  component: { group: frontend }
process:
  migrate:   { group: db }
  build_api: { group: backend }
  build_ui:  { group: frontend }
---
schema >> migrate -> migrated
migrated >> build_api -> endpoint
ui_mockup >> build_ui -> component
```

---

## 09-parts — Parts

`parts:` declares sub-artifacts of a composite artifact. Short IDs + `label:` show how opaque keys pair with human-readable names.

```pfdsl
---
artifact:
  D0: { label: Source }
  D1:
    label: Release Package
    parts: [D2, D3, D4]
  D2: { label: Binary }
  D3: { label: Config }
  D4: { label: Release Notes }
process:
  P1: { label: Build }
---
D0 >> P1 -> D1
```

---

## 10-layout-tb — Layout direction

`layout.direction: TB` sets `rankdir=TB`. Default is `LR`.

```pfdsl
---
layout:
  direction: TB
---
requirements >> design -> spec
spec >> implement -> code
```

---

## 11-external-stakeholders — External stakeholders

`externalStakeholders:` on artifacts marks external consumers outside the flow graph. Excluded from orphan-terminal audit (`check --audit`).

```pfdsl
---
artifact:
  raw_data:
    label: Raw Data
  report:
    label: Monthly Report
    externalStakeholders: [Regulatory Authority, Audit Firm]
  summary:
    label: Executive Summary
    externalStakeholders: [Management]
---
raw_data >> analyze -> report
report >> summarize -> summary
```

---

## 12-subflow — Subflow

`subflow:` on a process links to a child `.pfdsl` file. The child's open inputs and terminals must bijectively match the parent process's normal inputs and outputs (V025).

```pfdsl
---
artifact:
  requirement:
    label: Requirements
  shipped_order:
    label: Shipped Order
process:
  fulfill_order:
    label: Order Fulfillment
    subflow: ./12-subflow-detail.pfdsl
---
requirement >> fulfill_order -> shipped_order
```

---

## 13-preset — Preset (extends)

`extends:` inherits `statusStyles` / `tag` / `group` from a preset file. Attribute-level deep merge: local values override inherited ones.

```pfdsl
---
extends: ./13-preset-base.pfdsl
artifact:
  backlog: { status: done }
  prototype: { status: wip }
  release: { status: todo }
---
backlog >> develop -> prototype
prototype >> review -> release
```

---

## 14-boundary — Boundary map

`boundary:` on a subflow process remaps parent artifact IDs to different child artifact IDs. Useful when reusing an independently-named child flow.

```pfdsl
---
artifact:
  order:
    label: Customer Order
  parcel:
    label: Parcel
process:
  fulfill:
    label: Fulfillment
    subflow: ./14-boundary-detail.pfdsl
    boundary:
      order: incoming_order
      parcel: outgoing_parcel
---
order >> fulfill -> parcel
```

---

## 15-index — Index field

`index:` assigns an optional positive integer to artifacts and processes (independent namespaces). No graph-semantic effect; `pfdsl reindex` numbers nodes in topological order.

```pfdsl
---
artifact:
  requirement: { index: 1 }
  spec:        { index: 2 }
  code:        { index: 3 }
process:
  design:      { index: 1 }
  implement:   { index: 2 }
---
requirement >> design -> spec
spec >> implement -> code
```

---

## 16-basepath — basePath field

`basePath:` sets the base directory for resolving `location:` file paths and `command:` working directory. Defaults to the `.pfdsl` file's directory when omitted.

```pfdsl
---
basePath: ../
process:
  build:
    command: npm run build
    label: Build
artifact:
  source:
    label: Source Code
  output:
    label: Build Output
    location: dist/index.js
---
source >> build -> output
```

---

## 17-type — type field

`type:` declares the PFD kind (`roadmap`, `workflow`, `runtime-pipeline`). Values outside the enum cause an error (V031). `pfdsl ready` rejects `type: workflow` / `type: runtime-pipeline`; omitting `type:` is allowed and skips the kind check.

```pfdsl
---
type: roadmap
artifact:
  requirements:
    label: Requirements
    status: done
  implementation:
    label: Implementation
    status: wip
process:
  build:
    label: Build
---
requirements >> build -> implementation
```

---

## pfdsl_implementation_flow — PFDSL toolchain roadmap

How PFDSL itself was built — a snapshot of the toolchain implementation flow, written in PFDSL (dogfooding).

```pfdsl
---
title: PFDSL 実装計画フロー
version: 0.3
dslVersion: 0.0.6
description: PFDSL 仕様に基づくツールチェーン実装のプロセスフロー記述
tags: [implementation, roadmap]

layout:
  direction: TB

statusStyles:
  done:    { fillcolor: lightgray, style: filled, fontcolor: dimgray }
  wip:     { fillcolor: lightyellow, style: filled }
  todo:    { fillcolor: yellow, style: filled }
  waiting: { fillcolor: salmon, style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }

artifact:
  spec_v0_0_2:
    label: PFDSL仕様書 v0.0.2
    status: done
  core_architecture:
    label: コアアーキテクチャ文書
    status: done
  repo_scaffold:
    label: リポジトリ骨格
    status: done
  build_config:
    label: ビルド設定
    status: done
  shared_types:
    label: 共有型定義
    status: done
  token_spec:
    label: トークン規則
    status: done
  ast_schema:
    label: ASTスキーマ
    status: done
  diagnostic_schema:
    label: 診断スキーマ
    status: done
  graph_schema:
    label: グラフスキーマ
    status: done
  lexer:
    label: Lexer実装
    status: done
  frontmatter_loader:
    label: Frontmatterローダ
    status: done
  parser:
    label: Parser実装
    status: done
  normalizer:
    label: Normalizer実装
    status: done
  validator:
    label: Validator実装
    status: done
  canonical_sorter:
    label: 正準順序ソータ
    status: done
  formatter:
    label: Formatter実装
    status: done
  core_modules:
    label: コアモジュール群
    parts: [lexer, frontmatter_loader, parser, normalizer, validator, canonical_sorter, formatter]
    status: done
  core_library:
    label: コアライブラリ (@pfdsl/core)
    status: done
  group_types:
    label: GroupMeta型定義 (v0.0.5)
    status: done
  group_subgraph_export:
    label: subgraph cluster エクスポート (v0.0.5)
    status: done
  graphviz_exporter:
    label: Graphvizエクスポータ
    status: done
  preview_engine:
    label: プレビューエンジン
    status: done
  vscode_shell:
    label: VSCode拡張シェル
    status: done
  language_service:
    label: 言語サービス (LSP)
    status: done
  preview_panel:
    label: プレビューパネル
    status: done
  format_command:
    label: フォーマットコマンド
    status: done
  hover_support:
    label: ホバーサポート
    status: done
  diagnostics_ui:
    label: 診断UI
    status: done
  syntax_highlight:
    label: シンタックスハイライト
    status: done
  vscode_extension:
    label: VSCode拡張統合
    status: done
  rc_extension:
    label: リリース候補版
    status: done
  published_extension:
    label: 公開版拡張
    status: done
  workflow_usage:
    label: 日常運用知見
    status: todo
  cli_tool:
    label: CLIツール
    status: done
  metadata_exporter:
    label: メタデータエクスポータ
    status: done
  diff_analyzer:
    label: 差分解析ツール
    status: done
  cli_published:
    label: CLI npm公開
    description: "@pfdsl/cli 0.0.4 を npm 公開済み。tag push 起動の GitHub Actions + Trusted Publishing (OIDC)。tsup でワークスペース依存をバンドル（@hpcc-js/wasm のみ外部）。0.0.3 は起動時 \"Dynamic require of process\" エラーで broken → tsup.config.ts に createRequire banner 追加で修正（PR #24）"
    status: done
  agent_skill:
    label: AI agentスキル (pfdsl読み書き)
    status: done
  pdf_png_export:
    label: PDF/PNGエクスポート
    status: done
    description: "cli_tool の graph --format pdf|png。Puppeteer (headless Chromium) 経由でSVG→PDF/PNG変換、optional peer dependencyとして実装（#72/#74、拡張連携は#83）"
  group_fill_export:
    label: groupクラスタ塗り
    status: done
    description: "graphviz_exporter のsubgraph clusterにstyle=filledを付与し宣言色をfillcolorとして適用（#15/#77）"
  preview_minimap:
    label: プレビューminimap
    status: done
    description: "vscode拡張プレビューパネルへのminimapオーバーレイ、ドラッグでメインビュー追従（#17/#81）"
  skill_sync_command:
    label: skill syncコマンド
    status: done
    description: "`pfdsl skill sync pfd-ops`。外部採用リポの pfd-ops を一発最新化。npm同梱（tsup onSuccessで dist/skills/pfd-ops へコピー）+ L3採用済み判定で install/ 条件付き上書き + L4 scaffold + gh ラベル確認。consumer = 外部プロジェクトでの pfd-ops 運用（#90、設計 docs/superpowers/specs/2026-06-16-pfd-ops-sync-command-design.md）。v0.0.5 で公開予定"

process:
  define_architecture:
    label: アーキテクチャ定義
  define_repo_structure:
    label: リポジトリ構造設計
  define_build_policy:
    label: ビルドポリシー策定
  define_shared_types:
    label: 共有型定義
  define_token_rules:
    label: トークン規則定義
  define_ast_schema:
    label: ASTスキーマ定義
  define_diagnostic_schema:
    label: 診断スキーマ定義
  define_graph_schema:
    label: グラフスキーマ定義
  implement_lexer:
    label: Lexer実装
  implement_frontmatter_loader:
    label: Frontmatterローダ実装
  implement_parser:
    label: Parser実装
  implement_normalizer:
    label: Normalizer実装
  implement_validator:
    label: Validator実装
  implement_canonical_sorter:
    label: 正準順序ソータ実装
  implement_formatter:
    label: Formatter実装
  integrate_core_modules:
    label: コアモジュール統合
  package_core_library:
    label: コアライブラリパッケージング
  implement_graphviz_exporter:
    label: Graphvizエクスポータ実装
  implement_preview_engine:
    label: プレビューエンジン実装
  create_vscode_extension_shell:
    label: VSCode拡張シェル作成
  implement_language_service:
    label: 言語サービス実装
  implement_preview_panel:
    label: プレビューパネル実装
  implement_format_command:
    label: フォーマットコマンド実装
  implement_hover_support:
    label: ホバーサポート実装
  implement_diagnostics_ui:
    label: 診断UI実装
  implement_syntax_highlight:
    label: シンタックスハイライト実装
  integrate_vscode_extension:
    label: VSCode拡張統合
  package_release_candidate:
    label: RCパッケージング
  release_marketplace:
    label: Marketplace公開
  adopt_daily_workflow:
    label: 日常ワークフロー導入
  implement_cli_wrapper:
    label: CLIラッパー実装
  implement_metadata_exporter:
    label: メタデータエクスポータ実装
  implement_diff_analysis:
    label: 差分解析実装
  publish_cli:
    label: CLI npm公開
  write_agent_skill:
    label: AI agentスキル作成
  implement_pdf_png_export:
    label: PDF/PNGエクスポート実装
  implement_group_fill_export:
    label: groupクラスタ塗り実装
  implement_preview_minimap:
    label: minimap実装
  implement_skill_sync:
    label: skill sync実装
---

# Phase 0: アーキテクチャ定義

spec_v0_0_2 >> define_architecture -> core_architecture

core_architecture >> define_repo_structure -> repo_scaffold
core_architecture >> define_build_policy -> build_config
core_architecture >> define_shared_types -> shared_types

core_architecture >> define_token_rules -> token_spec
core_architecture >> define_ast_schema -> ast_schema
core_architecture >> define_diagnostic_schema -> diagnostic_schema
core_architecture >> define_graph_schema -> graph_schema

# Phase 1: コア層実装

# Frontmatter は Lexer より前に分離する
shared_types >> implement_frontmatter_loader -> frontmatter_loader

[token_spec, shared_types] >> implement_lexer -> lexer

[token_spec, ast_schema, lexer, frontmatter_loader, shared_types]
  >> implement_parser -> parser

[parser, graph_schema] >> implement_normalizer -> normalizer

[normalizer, graph_schema] >> implement_canonical_sorter -> canonical_sorter

[normalizer, diagnostic_schema] >> implement_validator -> validator

[parser, canonical_sorter] >> implement_formatter -> formatter

[lexer, frontmatter_loader, parser, normalizer, validator, canonical_sorter, formatter]
  >> integrate_core_modules -> core_modules

[core_modules, build_config, repo_scaffold]
  >> package_core_library -> core_library

# Phase 2: 出力層

core_library >> implement_graphviz_exporter -> graphviz_exporter

# v0.0.5: group 概念 (subgraph cluster)
shared_types >> implement_group_types -> group_types
[graphviz_exporter, group_types] >> implement_group_subgraph_export -> group_subgraph_export

[core_library, graphviz_exporter] >> implement_preview_engine -> preview_engine

core_library >> implement_cli_wrapper -> cli_tool

# Phase 3: VSCode 拡張

repo_scaffold >> create_vscode_extension_shell -> vscode_shell

[vscode_shell, core_library] >> implement_language_service -> language_service
[vscode_shell, preview_engine] >> implement_preview_panel -> preview_panel
[vscode_shell, core_library] >> implement_format_command -> format_command
[vscode_shell, core_library] >> implement_hover_support -> hover_support
[vscode_shell, core_library] >> implement_diagnostics_ui -> diagnostics_ui
vscode_shell >> implement_syntax_highlight -> syntax_highlight

[language_service, preview_panel, format_command, hover_support, diagnostics_ui, syntax_highlight]
  >> integrate_vscode_extension -> vscode_extension

# Phase 4: リリース

vscode_extension >> package_release_candidate -> rc_extension

rc_extension >> release_marketplace -> published_extension

# Phase 5: 日常運用・継続改善

published_extension >> adopt_daily_workflow -> workflow_usage

# 運用知見を実装プロセスへフィードバック (生成元は変更しない)
workflow_usage >>? implement_validator
workflow_usage >>? implement_formatter
workflow_usage >>? implement_preview_engine

# 周辺ツール

core_library >> implement_metadata_exporter -> metadata_exporter
cli_tool >> implement_diff_analysis -> diff_analyzer
cli_tool >> publish_cli -> cli_published
cli_tool >> write_agent_skill -> agent_skill
cli_tool >> implement_pdf_png_export -> pdf_png_export
graphviz_exporter >> implement_group_fill_export -> group_fill_export
preview_panel >> implement_preview_minimap -> preview_minimap

cli_tool >> implement_skill_sync -> skill_sync_command
```

---

