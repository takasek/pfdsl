# PFDSL Samples

Re-generate: `node scripts/gen-samples.mjs`

## 01-simple-chain — Simple chain

`>>` (artifact→process) and `->` (process→artifact).

```pfdsl
requirements >> design -> spec
```

<img src="01-simple-chain.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "design" [shape=ellipse, label="design"];
  "requirements" [shape=box, label="requirements", penwidth="2"];
  "spec" [shape=box, label="spec", penwidth="2"];

  "requirements" -> "design";
  "design" -> "spec";
}
```

</details>

---

## 02-feedback — Feedback edge

`>>?` renders as a dashed edge with `constraint=false` — does not affect rank.

```pfdsl
spec >> implement -> code
code >> verify -> bug_report
bug_report >>? implement
```

<img src="02-feedback.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "bug_report" [shape=box, label="bug_report", penwidth="2"];
  "code" [shape=box, label="code"];
  "implement" [shape=ellipse, label="implement"];
  "spec" [shape=box, label="spec", penwidth="2"];
  "verify" [shape=ellipse, label="verify"];

  "spec" -> "implement";
  "implement" -> "code";
  "code" -> "verify";
  "verify" -> "bug_report";
  "bug_report" -> "implement" [style=dashed, color="#888888", constraint=false];
}
```

</details>

---

## 03-set-input — Set input

`[A, B] >> P` expands to two input edges.

```pfdsl
[schema, seed_data] >> migrate -> database
```

<img src="03-set-input.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "database" [shape=box, label="database", penwidth="2"];
  "migrate" [shape=ellipse, label="migrate"];
  "schema" [shape=box, label="schema", penwidth="2"];
  "seed_data" [shape=box, label="seed_data", penwidth="2"];

  "schema" -> "migrate";
  "seed_data" -> "migrate";
  "migrate" -> "database";
}
```

</details>

---

## 04-set-output — Set output

`P -> [A, B]` expands to two output edges.

```pfdsl
source >> build -> [binary, docs]
```

<img src="04-set-output.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "binary" [shape=box, label="binary", penwidth="2"];
  "build" [shape=ellipse, label="build"];
  "docs" [shape=box, label="docs", penwidth="2"];
  "source" [shape=box, label="source", penwidth="2"];

  "source" -> "build";
  "build" -> "binary";
  "build" -> "docs";
}
```

</details>

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

<img src="05-label-cjk.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "D1" [shape=box, label="D1\n紙のアンケート", width=1.70, penwidth="2"];
  "D2" [shape=box, label="D2\nデジタルアンケート", width=2.10, penwidth="2"];
  "P1" [shape=ellipse, label="P1\nスキャン", width=1.10];

  "D1" -> "P1";
  "P1" -> "D2";
}
```

</details>

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

<img src="06-status-styles.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "analyze" [shape=ellipse, label="analyze"];
  "ingest" [shape=ellipse, label="ingest"];
  "processed" [shape=box, label="processed", xlabel="done, external", fillcolor="#d4edda", color="#0066cc", style="filled", penwidth="2"];
  "raw_data" [shape=box, label="raw_data", xlabel="external, sensitive", color="#0066cc", style="dashed", penwidth="2"];
  "report" [shape=box, label="report", xlabel="todo, external", fillcolor="#f8f9fa", color="#0066cc", style="filled", penwidth="2"];
  "spec" [shape=box, label="spec", xlabel="wip", fillcolor="#fff3cd", style="filled", penwidth="2"];

  "raw_data" -> "ingest";
  "ingest" -> "processed";
  "spec" -> "analyze";
  "analyze" -> "report";
  "processed" -> "analyze";
}
```

</details>

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

<img src="08-groups.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  subgraph cluster_backend {
    label="Backend";
    color="lightyellow";
    style="filled";
    fillcolor="lightyellow";
    subgraph cluster_db {
      label="DB Layer";
      color="#b3987d";
      style="filled";
      fillcolor="#ffd9b3";
      "migrate" [shape=ellipse, label="migrate"];
      "migrated" [shape=box, label="migrated"];
      "schema" [shape=box, label="schema", penwidth="2"];
    }
    "build_api" [shape=ellipse, label="build_api"];
    "endpoint" [shape=box, label="endpoint", penwidth="2"];
  }
  subgraph cluster_frontend {
    label="Frontend";
    color="lightblue";
    style="filled";
    fillcolor="lightblue";
    "build_ui" [shape=ellipse, label="build_ui"];
    "component" [shape=box, label="component", penwidth="2"];
    "ui_mockup" [shape=box, label="ui_mockup", penwidth="2"];
  }

  "schema" -> "migrate";
  "migrate" -> "migrated";
  "migrated" -> "build_api";
  "build_api" -> "endpoint";
  "ui_mockup" -> "build_ui";
  "build_ui" -> "component";
}
```

</details>

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

<img src="09-parts.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "D0" [shape=box, label="D0\nSource", penwidth="2"];
  "D1" [shape=box, label="D1\nRelease Package", penwidth="2"];
  "D2" [shape=box, label="D2\nBinary", penwidth="2"];
  "D3" [shape=box, label="D3\nConfig", penwidth="2"];
  "D4" [shape=box, label="D4\nRelease Notes", penwidth="2"];
  "P1" [shape=ellipse, label="P1\nBuild"];

  "D0" -> "P1";
  "P1" -> "D1";
}
```

</details>

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

<img src="10-layout-tb.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=TB;
  newrank=true;

  "code" [shape=box, label="code", penwidth="2"];
  "design" [shape=ellipse, label="design"];
  "implement" [shape=ellipse, label="implement"];
  "requirements" [shape=box, label="requirements", penwidth="2"];
  "spec" [shape=box, label="spec"];

  "requirements" -> "design";
  "design" -> "spec";
  "spec" -> "implement";
  "implement" -> "code";
}
```

</details>

---

## 11-external-stakeholders — External stakeholders

`externalStakeholders:` on artifacts marks external consumers outside the flow graph. Excluded from orphan-terminal audit (`graph io`).

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

<img src="11-external-stakeholders.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "analyze" [shape=ellipse, label="analyze"];
  "raw_data" [shape=box, label="raw_data\nRaw Data", penwidth="2"];
  "report" [shape=box, label="report\nMonthly Report", tooltip="Monthly Report\nexternalStakeholders: Regulatory Authority, Audit Firm"];
  "summarize" [shape=ellipse, label="summarize"];
  "summary" [shape=box, label="summary\nExecutive Summary", tooltip="Executive Summary\nexternalStakeholders: Management", penwidth="2"];

  "raw_data" -> "analyze";
  "analyze" -> "report";
  "report" -> "summarize";
  "summarize" -> "summary";
}
```

</details>

---

## 12-subflow — Subflow

`subflow:` on a process links to a child `.pfdsl` file. The child's open inputs and terminals must bijectively match the parent process's normal inputs and outputs (V034).

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

<img src="12-subflow.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "fulfill_order" [shape=ellipse, label="fulfill_order\nOrder Fulfillment", tooltip="Order Fulfillment\nsubflow: ./12-subflow-detail.pfdsl", peripheries="2"];
  "requirement" [shape=box, label="requirement\nRequirements", penwidth="2"];
  "shipped_order" [shape=box, label="shipped_order\nShipped Order", penwidth="2"];

  "requirement" -> "fulfill_order";
  "fulfill_order" -> "shipped_order";
}
```

</details>

---

## 12-subflow-detail — Subflow child

The child flow referenced by `12-subflow.pfdsl`'s `subflow:` — its open input and terminal artifacts (`requirement`, `shipped_order`) bijectively match the parent process's inputs and outputs.

```pfdsl
---
artifact:
  requirement:
    label: Requirements
    description: Boundary artifact — matches parent normal input.
  picked_items:
    label: Picked Items
  packed_box:
    label: Packed Box
  shipped_order:
    label: Shipped Order
    description: Boundary artifact — matches parent output.
---
requirement >> pick_items -> picked_items
picked_items >> pack -> packed_box
packed_box >> ship -> shipped_order
```

<img src="12-subflow-detail.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "pack" [shape=ellipse, label="pack"];
  "packed_box" [shape=box, label="packed_box\nPacked Box"];
  "pick_items" [shape=ellipse, label="pick_items"];
  "picked_items" [shape=box, label="picked_items\nPicked Items"];
  "requirement" [shape=box, label="requirement\nRequirements", tooltip="Requirements\n\nBoundary artifact — matches parent normal input.", penwidth="2"];
  "ship" [shape=ellipse, label="ship"];
  "shipped_order" [shape=box, label="shipped_order\nShipped Order", tooltip="Shipped Order\n\nBoundary artifact — matches parent output.", penwidth="2"];

  "requirement" -> "pick_items";
  "pick_items" -> "picked_items";
  "picked_items" -> "pack";
  "pack" -> "packed_box";
  "packed_box" -> "ship";
  "ship" -> "shipped_order";
}
```

</details>

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

<img src="13-preset.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "backlog" [shape=box, label="backlog", xlabel="done", penwidth="2"];
  "develop" [shape=ellipse, label="develop"];
  "prototype" [shape=box, label="prototype", xlabel="wip"];
  "release" [shape=box, label="release", xlabel="todo", penwidth="2"];
  "review" [shape=ellipse, label="review"];

  "backlog" -> "develop";
  "develop" -> "prototype";
  "prototype" -> "review";
  "review" -> "release";
}
```

</details>

---

## 13-preset-base — Preset base

The base file referenced by `13-preset.pfdsl`'s `extends:` — declares `statusStyles` inherited by the child.

```pfdsl
---
statusStyles:
  done: { fillcolor: "#d4edda", style: filled }
  wip:  { fillcolor: "#fff3cd", style: filled }
  todo: { fillcolor: "#f8f9fa", style: filled }
---
```

<img src="13-preset-base.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

}
```

</details>

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

<img src="14-boundary.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "fulfill" [shape=ellipse, label="fulfill\nFulfillment", tooltip="Fulfillment\nsubflow: ./14-boundary-detail.pfdsl", peripheries="2"];
  "order" [shape=box, label="order\nCustomer Order", penwidth="2"];
  "parcel" [shape=box, label="parcel\nParcel", penwidth="2"];

  "order" -> "fulfill";
  "fulfill" -> "parcel";
}
```

</details>

---

## 14-boundary-detail — Boundary child

The child flow referenced by `14-boundary.pfdsl`'s `subflow:` — its artifact IDs (`incoming_order`, `outgoing_parcel`) are remapped from the parent's `order` / `parcel` via `boundary:`.

```pfdsl
---
artifact:
  incoming_order:
    label: Incoming Order
    description: Boundary artifact — mapped from parent 'order' via boundary:.
  picked:
    label: Picked Items
  outgoing_parcel:
    label: Outgoing Parcel
    description: Boundary artifact — mapped from parent 'parcel' via boundary:.
---
incoming_order >> pick -> picked
picked >> pack -> outgoing_parcel
```

<img src="14-boundary-detail.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "incoming_order" [shape=box, label="incoming_order\nIncoming Order", tooltip="Incoming Order\n\nBoundary artifact — mapped from parent 'order' via boundary:.", penwidth="2"];
  "outgoing_parcel" [shape=box, label="outgoing_parcel\nOutgoing Parcel", tooltip="Outgoing Parcel\n\nBoundary artifact — mapped from parent 'parcel' via boundary:.", penwidth="2"];
  "pack" [shape=ellipse, label="pack"];
  "pick" [shape=ellipse, label="pick"];
  "picked" [shape=box, label="picked\nPicked Items"];

  "incoming_order" -> "pick";
  "pick" -> "picked";
  "picked" -> "pack";
  "pack" -> "outgoing_parcel";
}
```

</details>

---

## 15-index — Index field

`index:` assigns an optional positive integer to artifacts and processes (independent namespaces). No graph-semantic effect; `pfdsl meta reindex` numbers nodes in topological order.

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

<img src="15-index.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "code" [shape=box, label="code", penwidth="2"];
  "design" [shape=ellipse, label="design"];
  "implement" [shape=ellipse, label="implement"];
  "requirement" [shape=box, label="requirement", penwidth="2"];
  "spec" [shape=box, label="spec"];

  "requirement" -> "design";
  "design" -> "spec";
  "spec" -> "implement";
  "implement" -> "code";
}
```

</details>

---

## 16-basepath — basePath field

`basePath:` sets the base directory for resolving `location:` file paths and `command:` working directory. Defaults to the `.pfdsl` file's directory when omitted. `location:` may also be set on processes.

```pfdsl
---
basePath: ../
process:
  build:
    command: npm run build
    label: Build
    location: https://github.com/example/repo/issues/1
artifact:
  source:
    label: Source Code
  output:
    label: Build Output
    location: dist/index.js
---
source >> build -> output
```

<img src="16-basepath.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "build" [shape=ellipse, label="build\nBuild", tooltip="Build\ncommand: npm run build\nlocation: https://github.com/example/repo/issues/1", href="https://github.com/example/repo/issues/1"];
  "output" [shape=box, label="output\nBuild Output", tooltip="Build Output\nlocation: dist/index.js", penwidth="2"];
  "source" [shape=box, label="source\nSource Code", penwidth="2"];

  "source" -> "build";
  "build" -> "output";
}
```

</details>

---

## 17-type — type field

`type:` declares the PFD kind (`roadmap`, `workflow`, `runtime-pipeline`). Values outside the enum cause an error (V031). `pfdsl status ready` rejects any explicit non-`roadmap` type; omitting `type:` is treated as `roadmap` and allowed, with a warning (W006).

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

<img src="17-type.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;
  newrank=true;

  "build" [shape=ellipse, label="build\nBuild"];
  "implementation" [shape=box, label="implementation\nImplementation", xlabel="wip", penwidth="2"];
  "requirements" [shape=box, label="requirements\nRequirements", xlabel="done", penwidth="2"];

  "requirements" -> "build";
  "build" -> "implementation";
}
```

</details>

---

## pfdsl_implementation_flow — PFDSL toolchain roadmap

How PFDSL itself was built — a snapshot of the toolchain implementation flow, written in PFDSL (dogfooding).

<img src="pfdsl_implementation_flow.svg">

[Source](pfdsl_implementation_flow.pfdsl) · [DOT](pfdsl_implementation_flow.dot)

---

