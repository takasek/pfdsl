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

`status:` + `tags:` on artifacts; `statusStyles:` and `tagStyles:` apply DOT attributes. Multiple tags merge; `status` wins conflicts.

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
tagStyles:
  external:  { color: "#0066cc", penwidth: "2" }
  sensitive: { style: dashed }
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
artifact:
  api_spec:  { group: backend }
  endpoint:  { group: backend }
  ui_mockup: { group: frontend }
  component: { group: frontend }
process:
  build_api: { group: backend }
  build_ui:  { group: frontend }
---
api_spec >> build_api -> endpoint
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

## 11-practical-web-dev — Practical integrated example

Real-world flow combining feedback edges, set notation, multi-output, status styling, and owner metadata. Demonstrates the quality guidelines: essential artifact in outputs, single revision pattern, no implicit dependencies.

```pfdsl
---
title: Webアプリ機能開発フロー
layout:
  direction: LR
  maxWidth: 120

artifact:
  requirement:
    label: 要求仕様書
    status: done
    description: 機能要求・受け入れ条件を記述した仕様書
    owner: PO
  design_doc:
    label: 設計書
    status: done
    description: API設計・画面設計・DB設計を含む技術設計書
    owner: Tech Lead
  implementation:
    label: 実装コード
    status: wip
    description: プルリクエスト単位の実装差分
    owner: Dev
  review_comment:
    label: レビュー指摘票
    status: wip
    description: コードレビューで挙げられた指摘事項
    owner: Reviewer
  test_report:
    label: テスト報告書
    status: todo
    description: QAによる動作確認結果・不具合一覧
    owner: QA
  bug_ticket:
    label: バグチケット
    status: todo
    description: QA検出バグを起票したチケット
    owner: QA
  deployed_release:
    label: リリース版
    status: todo
    description: 本番環境にデプロイされた成果物
    owner: Tech Lead
  release_note:
    label: リリースノート
    status: todo
    description: 本番リリース内容の変更点まとめ
    owner: Tech Lead

process:
  design:
    label: 設計
    description: 要求仕様を読み込み技術設計書を作成する
    owner: Tech Lead
  implement:
    label: 実装
    description: 設計書に基づきコードを書きPRを作成する
    owner: Dev
  review_code:
    label: コードレビュー
    description: PRを読み指摘票を作成する
    owner: Reviewer
  qa_test:
    label: QAテスト
    description: ステージング環境で動作確認しテスト報告書を作成する
    owner: QA
  release:
    label: リリース
    description: 本番デプロイとリリースノート作成
    owner: Tech Lead

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  blocked: { fillcolor: "#f8d7da", style: filled }
---

requirement >> design -> design_doc

design_doc >> implement -> implementation

implementation >> review_code -> review_comment

review_comment >>? implement

[implementation, design_doc] >> qa_test -> [test_report, bug_ticket]

bug_ticket >>? implement

[test_report, implementation] >> release -> [deployed_release, release_note]
```

---

