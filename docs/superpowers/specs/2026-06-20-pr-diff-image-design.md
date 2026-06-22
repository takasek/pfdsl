# PR diff image: visual diff rendering for changed `.pfdsl` files

## Overview

Today `pr-diff-images.yml` renders **before** and **after** SVGs for each `.pfdsl`
file changed in a merged PR, and embeds both in the PR description. This issue (#99) adds a third **diff** image: a single SVG that overlays both versions and highlights only what changed — added nodes/edges in green, removed in red, metadata-changed nodes in yellow — hiding everything that stayed the same so the reader sees the delta at a glance.

The change is **additive, not a replacement**: the existing `pfdsl diff` text output (`+ node`, `- node`, …) stays the default, and before/after images stay.
The diff image is a new output format on the same command and a new third image in the workflow.

Final output: **before / after / diff** (3 images per changed file).

## Existing `pfdsl diff` (investigation result)

- `@pfdsl/core` `diffGraphs(a: Graph, b: Graph): DiffReport` — structural diff over graph topology only: `addedNodes`, `removedNodes`, `addedEdges`, `removedEdges`, `addedFeedback`, `removedFeedback`. **No "changed" concept** — a node whose `status` flips `todo→done` but keeps its id is invisible to the current diff, because status/label live in `Frontmatter`, not `Graph`.
- CLI `pfdsl diff <a> <b>` (`runDiff`) — text only, prints the six sections.
- VSCode `pfdsl.diff` — same `diffGraphs`, rendered as a text panel under the preview (`webview.ts` `renderDiffPanel`).

**Decision: integrate, don't replace.** Extend `DiffReport` with a `changedNodes`
field (back-compatible — existing consumers ignore it) and add a new render path.
The text output and VSCode panel gain `~ node X` lines for free.

## Component changes

### `@pfdsl/core` — `diff.ts`

Add metadata-change detection. Requires frontmatter (not just `Graph`), so widen the signature with optional frontmatters; callers that pass none keep today's behavior (`changedNodes` empty).

```ts
export interface DiffReport {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];   // NEW: id in both, metadata differs
  addedEdges: string[];
  removedEdges: string[];
  addedFeedback: string[];
  removedFeedback: string[];
}

export function diffGraphs(
  a: Graph,
  b: Graph,
  fmA?: Frontmatter | null,   // NEW (optional → back-compat)
  fmB?: Frontmatter | null,   // NEW
): DiffReport
```

**`changedNodes` rule** — id present in both `a.nodes` and `b.nodes`, and:

- kind changed (artifact↔process), **or**
- `fmA` and `fmB` both supplied and the node's metadata entry differs by deep structural equality. Metadata entry = `fm.artifact[id]` for an artifact, `fm.process[id]` for a process. Compare via stable-key JSON serialization (sort object keys; arrays compared in order — `tags`/`externalStakeholders`
  order is meaningful per the exporter's tag precedence).

If `fmA`/`fmB` are omitted, only the kind-change branch can fire (topology-only).

Edges carry no metadata → **edges are never "changed"**, only added/removed.

### `@pfdsl/graphviz-exporter` — new `exportDiffDot`

```ts
export function exportDiffDot(
  a: Graph, fmA: Frontmatter | null,
  b: Graph, fmB: Frontmatter | null,
  options?: ExportOptions,
): string
```

Builds one DOT digraph representing the union, classified by diff status. Reuses the existing private helpers (`wrapLabel`, `calcMinWidth`, `quote`, `measureTextWidth`) — extract them so both `exportDot` and `exportDiffDot` share them; **`exportDot` stays behaviorally unchanged** (non-diff rendering path).

**Node classification & visibility**

1. Classify every id in `A.nodes ∪ B.nodes`:
   - in B not A → **added**
   - in A not B → **removed**
   - `changedNodes` → **changed**
   - else → **unchanged**
2. Classify every edge in `(A ∪ B).primaryEdges` and `.feedbackEdges`:
   added (in B not A) / removed (in A not B) / unchanged.
3. **Visible nodes** = added ∪ removed ∪ changed ∪ {endpoints of any added or removed edge}. An unchanged node that is visible *only* as an edge endpoint is a **context** node.
4. **Visible edges** = added ∪ removed edges only. Unchanged edges are hidden (even between two visible nodes) to keep the delta legible.
5. Unchanged nodes that are not edge endpoints → **omitted** entirely.

**Node content**: render B's metadata for added / changed / context nodes; A's for removed nodes (B has none). Label wrapping / min-width identical to `exportDot`.

**Diff palette** (overrides status/tag fill — the diff image is about change, not status; a graph-label legend disambiguates):

- added — `fillcolor="#c3e6cb"`, `color="#28a745"`, `style="filled"`
- removed — `fillcolor="#f5c6cb"`, `color="#dc3545"`, `style="filled"`
- changed — `fillcolor="#ffeeba"`, `color="#e0a800"`, `style="filled"`
- context — `fillcolor="#f5f5f5"`, `color="#bbbbbb"`, `fontcolor="#777777"`
- added edge — `color="#28a745"`
- removed edge — `color="#dc3545", style="dashed"`
- feedback edges keep `style=dashed`; diff color layered on top.

Shapes stay kind-driven (artifact=box, process=ellipse). Groups/clusters are dropped in diff mode (a partial graph rarely fills a cluster cleanly).

**Graph label / legend**: `<title> — diff` plus a one-line legend `green = added · red = removed · yellow = changed`.

**Empty diff** (no added/removed/changed): emit a valid digraph with a single note node `label="No structural or metadata changes"` so the command never errors and the SVG is always renderable.

### `@pfdsl/preview-engine` — `renderDiff`

```ts
export async function renderDiff(
  a: Graph, fmA: Frontmatter | null,
  b: Graph, fmB: Frontmatter | null,
  options?: RenderOptions,
): Promise<string>   // DOT or SVG
```

Mirrors `renderGraph`: `exportDiffDot(...)` → DOT; if `format === "dot"` return DOT, else `renderDotToSvg(dot)` (already exported — reused, no new wasm path).

### `@pfdsl/cli` — `diff` command gains `--format`

```
pfdsl diff <a> <b> [--format text|dot|svg]   (default: text)
```

- `text` — current six sections **plus** `~ node X` for each `changedNodes`
  entry (computed by passing both frontmatters into `diffGraphs`). VSCode panel inherits this when its `diffGraphs` call is likewise upgraded (out of scope here; `webview.ts` already only renders the fields it knows).
- `dot` — `renderDiff(..., { format: "dot" })`.
- `svg` — `renderDiff(..., { format: "svg" })`.

`runDiff` loads both files with `analyze` (it already needs the graph; now keep the frontmatter too) and routes on `--format`. Reject unknown formats with exit 2, matching `graph`.

### Workflow — `.github/workflows/pr-diff-images.yml` + `scripts/generate-pr-diff-images.mjs`

- **Trigger unchanged**: `pull_request: [closed]`, `if merged == true`. (Per design dialogue — keep merge-time generation.)
- `generate` phase: for each changed file, in addition to `*.before.svg` and `*.after.svg`, write `*.diff.svg` via `pfdsl diff <tmpBefore> <headFile> --format svg`. The script already materializes the base version to a temp file for the before image — reuse it as the diff's `<a>`. Newly-added file → no before → diff renders as all-green (a=empty graph); deleted file → all-red.
- `update-pr` phase: append a **Diff** subsection (raw URL to `*.diff.svg`)
  after Before/After in each file's block.

## Data flow

```
pfdsl diff a b --format svg
  → analyze(a) → Graph A, fmA
  → analyze(b) → Graph B, fmB
  → diffGraphs(A, B, fmA, fmB)        (classification reused inside exporter)
  → exportDiffDot(A, fmA, B, fmB)     → DOT (union, unchanged hidden, colored)
  → renderDotToSvg(dot)               → SVG
```

## Implementation (landed in #117)

Implemented in this PR as four dependency-ordered commits:

1. **core `changedNodes`** — `DiffReport.changedNodes` + `diffGraphs(a, b, fmA?, fmB?)`.
2. **exporter `exportDiffDot` + preview `renderDiff`** — visual diff DOT/SVG.
3. **CLI `diff --format text|dot|svg`** — `~ node` line + dot/svg render.
4. **workflow third image** — `generate-pr-diff-images.mjs` writes `*.diff.svg`
   and embeds a Diff section.

**Operational note**: step 4 invokes `pfdsl diff --format svg`, which only exists once the CLI carrying steps 1–3 is published to npm (`npm install -g @pfdsl/cli`
in `pr-diff-images.yml`). After this PR merges, a CLI release must ship before the diff image will render on subsequent PRs — until then the workflow's `pfdsl diff` call fails for the new flag. Track via `make release-status`.

## Testing

- core: `diffGraphs` — `changedNodes` for status flip, label change, kind change; empty when frontmatters omitted; existing added/removed cases regress-green.
- exporter: golden DOT for each class, context-node anchoring, hidden-unchanged, empty-diff note node.
- cli: `diff --format dot|svg|text`; unknown format → exit 2; `~ node` line.
- workflow / `generate-pr-diff-images.mjs`: added-file (all green) and deleted-file (all red) edge cases; manual verification of the rendered PR.
