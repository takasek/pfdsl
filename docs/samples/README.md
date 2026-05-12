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

  "D1" [shape=box, label="D1\n紙のアンケート", width=1.70];
  "D2" [shape=box, label="D2\nデジタルアンケート", width=2.10];
  "P1" [shape=ellipse, label="P1\nスキャン", width=1.10];

  "D1" -> "P1";
  "P1" -> "D2";
}
```

</details>

---

## 06-status-styles — Status styles

`status:` on artifacts + `statusStyles:` maps status values to DOT node attributes.

```pfdsl
---
artifact:
  requirements: { status: done }
  spec:         { status: wip }
  code:         { status: todo }
statusStyles:
  done: { fillcolor: "#d4edda", style: filled }
  wip:  { fillcolor: "#fff3cd", style: filled }
  todo: { fillcolor: "#f8f9fa", style: filled }
---
requirements >> design -> spec
spec >> implement -> code
```

<img src="06-status-styles.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;

  "code" [shape=box, label="code", fillcolor="#f8f9fa", style="filled"];
  "design" [shape=ellipse, label="design"];
  "implement" [shape=ellipse, label="implement"];
  "requirements" [shape=box, label="requirements", fillcolor="#d4edda", style="filled"];
  "spec" [shape=box, label="spec", fillcolor="#fff3cd", style="filled"];

  "requirements" -> "design";
  "design" -> "spec";
  "spec" -> "implement";
  "implement" -> "code";
}
```

</details>

---

## 07-tag-styles — Tag styles

`tags:` on artifacts + `tagStyles:` applies DOT attributes per tag.

```pfdsl
---
artifact:
  customer_data: { tags: [external] }
  report:        { tags: [external] }
tagStyles:
  external: { color: "#0066cc", penwidth: "2" }
---
customer_data >> analyze -> report
```

<img src="07-tag-styles.svg">

<details>
<summary>DOT</summary>

```dot
digraph PFDSL {
  rankdir=LR;

  "analyze" [shape=ellipse, label="analyze"];
  "customer_data" [shape=box, label="customer_data", color="#0066cc", penwidth="2"];
  "report" [shape=box, label="report", color="#0066cc", penwidth="2"];

  "customer_data" -> "analyze";
  "analyze" -> "report";
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
