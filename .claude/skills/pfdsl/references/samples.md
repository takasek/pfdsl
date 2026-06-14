# PFDSL Samples Reference

Annotated .pfdsl files illustrating each language feature.

## 01-simple-chain — Simple chain

"`>>` (artifact→process) and `->` (process→artifact)."

```pfdsl
---
title: Simple chain
description: "`>>` (artifact→process) and `->` (process→artifact)."
---
requirements >> design -> spec
```

---

## 02-feedback — Feedback edge

"`>>?` renders as a dashed edge with `constraint=false` — does not affect rank."

```pfdsl
---
title: Feedback edge
description: "`>>?` renders as a dashed edge with `constraint=false` — does not affect rank."
---
spec >> implement -> code
code >> verify -> bug_report
bug_report >>? implement
```

---

## 03-set-input — Set input

"`[A, B] >> P` expands to two input edges."

```pfdsl
---
title: Set input
description: "`[A, B] >> P` expands to two input edges."
---
[schema, seed_data] >> migrate -> database
```

---

## 04-set-output — Set output

"`P -> [A, B]` expands to two output edges."

```pfdsl
---
title: Set output
description: "`P -> [A, B]` expands to two output edges."
---
source >> build -> [binary, docs]
```

---

## 05-label-cjk — Label + CJK

"`label:` sets the display name shown below the node ID. CJK labels get a computed `width=` to prevent clipping in the wasm renderer."

```pfdsl
---
title: Label + CJK
description: "`label:` sets the display name shown below the node ID. CJK labels get a computed `width=` to prevent clipping in the wasm renderer."
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

"`status:` + `tags:` on artifacts; `statusStyles:` and `tagStyles:` apply DOT attributes. Multiple tags merge; `status` wins conflicts."

```pfdsl
---
title: Status & tag styles
description: "`status:` + `tags:` on artifacts; `statusStyles:` and `tagStyles:` apply DOT attributes. Multiple tags merge; `status` wins conflicts."
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

"`group:` on nodes + `group:` declarations produce `subgraph cluster_<id>` blocks."

```pfdsl
---
title: Groups
description: "`group:` on nodes + `group:` declarations produce `subgraph cluster_<id>` blocks."
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

"`parts:` declares sub-artifacts of a composite artifact. Short IDs + `label:` show how opaque keys pair with human-readable names."

```pfdsl
---
title: Parts
description: "`parts:` declares sub-artifacts of a composite artifact. Short IDs + `label:` show how opaque keys pair with human-readable names."
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

"`layout.direction: TB` sets `rankdir=TB`. Default is `LR`."

```pfdsl
---
title: Layout direction
description: "`layout.direction: TB` sets `rankdir=TB`. Default is `LR`."
layout:
  direction: TB
---
requirements >> design -> spec
spec >> implement -> code
```

---

