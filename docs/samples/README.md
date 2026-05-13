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
  "requirements" [shape=box, label="requirements"];
  "spec" [shape=box, label="spec"];

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

  "bug_report" [shape=box, label="bug_report"];
  "code" [shape=box, label="code"];
  "implement" [shape=ellipse, label="implement"];
  "spec" [shape=box, label="spec"];
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

  "database" [shape=box, label="database"];
  "migrate" [shape=ellipse, label="migrate"];
  "schema" [shape=box, label="schema"];
  "seed_data" [shape=box, label="seed_data"];

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

  "binary" [shape=box, label="binary"];
  "build" [shape=ellipse, label="build"];
  "docs" [shape=box, label="docs"];
  "source" [shape=box, label="source"];

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

  "D1" [shape=box, label="D1\n紙のアンケート", width=1.70];
  "D2" [shape=box, label="D2\nデジタルアンケート", width=2.10];
  "P1" [shape=ellipse, label="P1\nスキャン", width=1.10];

  "D1" -> "P1";
  "P1" -> "D2";
}
```

</details>

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
  "spec" [shape=box, label="spec", xlabel="wip", fillcolor="#fff3cd", style="filled"];

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
    "api_spec" [shape=box, label="api_spec"];
    "build_api" [shape=ellipse, label="build_api"];
    "endpoint" [shape=box, label="endpoint"];
  }
  subgraph cluster_frontend {
    label="Frontend";
    color="lightblue";
    "build_ui" [shape=ellipse, label="build_ui"];
    "component" [shape=box, label="component"];
    "ui_mockup" [shape=box, label="ui_mockup"];
  }

  "api_spec" -> "build_api";
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

  "D0" [shape=box, label="D0\nSource"];
  "D1" [shape=box, label="D1\nRelease Package"];
  "D2" [shape=box, label="D2\nBinary"];
  "D3" [shape=box, label="D3\nConfig"];
  "D4" [shape=box, label="D4\nRelease Notes"];
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

  "code" [shape=box, label="code"];
  "design" [shape=ellipse, label="design"];
  "implement" [shape=ellipse, label="implement"];
  "requirements" [shape=box, label="requirements"];
  "spec" [shape=box, label="spec"];

  "requirements" -> "design";
  "design" -> "spec";
  "spec" -> "implement";
  "implement" -> "code";
}
```

</details>

---

## Real-world example

[pfdsl_implementation_flow.pfdsl](../pfdsl_implementation_flow.pfdsl) — the PFDSL toolchain roadmap, written in PFDSL itself.

<img src="../pfdsl_implementation_flow.svg">

[Source](../pfdsl_implementation_flow.pfdsl) · [DOT](../pfdsl_implementation_flow.dot)
