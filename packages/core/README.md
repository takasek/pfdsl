# @pfdsl/core

Core pipeline for the PFDSL process-flow DSL: lex → parse → normalize → build graph → validate → sort → format.

## Install

```bash
pnpm add @pfdsl/core
```

Requires Node ≥ 18 (ESM only).

## Quick start

```ts
import { format } from '@pfdsl/core';

const source = `
[requirement, constraint] >> design -> spec
spec >>? design
`;

const { output, diagnostics } = format(source);
const errors = diagnostics.filter(d => d.severity === 'error');

if (errors.length === 0) {
  console.log(output);
}
```

`format()` is idempotent: `format(format(x).output).output === format(x).output`.

## API

### `format(source: string): FormatResult`

Run the full pipeline and return canonical text plus all diagnostics.

```ts
interface FormatResult {
  output: string;          // canonical edge list, one edge per line
  diagnostics: Diagnostic[]; // frontmatter + lex + parse + normalize + validate
}
```

### Graph differences

`diffGraphs(a, b, fmA?, fmB?)` retains the seven `string[]` fields of `DiffReport`: added, removed and changed nodes, added and removed primary edges, and added and removed feedback edges.
Edge strings are display values, sorted lexicographically after formatting; ordinary IDs keep their existing spelling, while IDs that need quoting use PFDSL escaping.
For example, the distinct endpoint pairs `("a -> b", "c")` and `("a", "b -> c")` display as `"a -> b" -> c` and `a -> "b -> c"`.
Consumers of the existing report do not need to migrate, but should not split its display strings to recover endpoints.

Renderers can use the additive `diffGraphsDetailed(a, b, fmA?, fmB?)` API, returning `{ report, primaryEdges, feedbackEdges }`.
Its `report` is the same `DiffReport`; each classified edge retains its endpoints and a `status` of `added`, `removed` or `unchanged`.
Primary edges use `from` and `to`, and feedback edges use `artifact` and `process`.
Identity compares endpoint pairs within each edge category, independently of display strings; duplicates and edge input order do not create differences.

### Stage-by-stage API

`analyzeSource(source, options)` returns the same analysis as `analyze()` plus a `sourceMap` of frontmatter declarations and fields.
Each declaration records its section, decoded ID, authored key range, and fields with decoded string values and source ranges.
Ranges use one-based lines and columns and zero-based UTF-16 offsets; scalar value ranges exclude surrounding quotes, while declaration key ranges include them.
Aliases point to their use site, and folded scalars retain their decoded value and authored span.
The model does not rewrite source or expose a mutable YAML document.
The existing `analyze()`, `parse()`, and `loadFrontmatter()` return shapes are unchanged.

`resolveEffectiveFrontmatter(entryPath, frontmatter, loader)` treats the supplied frontmatter as the entry snapshot, including its `extends` references.
The loader retrieves dependencies only; local presentation values win last, even when the entry file has not been saved.

For tools that need intermediate state (LSP, exporters):

```ts
import {
  parse,             // source → { document, frontmatter, diagnostics }
  normalizeDocument, // document → { edges, nodeKinds, diagnostics }
  buildGraph,        // edges → graph (primary + feedback + nodes)
  validateGraph,     // graph → diagnostics
  sortEdges,         // edges + graph → canonically sorted edges
  formatEdges,       // sorted edges → text
} from '@pfdsl/core';

const { document, frontmatter, diagnostics: parseDiags } = parse(source);
const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
const graph = buildGraph(edges, nodeKinds);
const validateDiags = validateGraph(edges, graph, frontmatter);
const sorted = sortEdges(edges, graph);
const text = formatEdges(sorted);
```

All AST / token / diagnostic / graph types are exported as type-only.

## DSL syntax (cheat sheet)

```pfdsl
---                              # optional YAML frontmatter
artifact:
  spec:
    label: 仕様書
process:
  design:
    label: 設計
  build:
    label: 実装
    parts: [design]              # composition (build is decomposed into design)
---

# Edges
A >> P                           # A is input to process P
P -> B                           # P produces artifact B
A >>? P                          # feedback edge (semantic only)

# Chain
A >> P -> B >> Q -> C            # A→P→B→Q→C, multiple segments

# Set notation (Cartesian product)
[a, b] >> P -> [x, y]            # 2 inputs × 2 outputs = 4 edges

# Line continuation
[a, b, c]
  >> P -> result                 # leading-op continuation OK
A >> P
  -> B                           # continuation before -> OK

# Comments and blank lines
# this is a comment
[a, b]                           # blank line below would terminate the statement
  >> P -> X
```

Full grammar and validation rules: see [docs/spec/spec.md](../../docs/spec/spec.md).

## Diagnostics

Errors and warnings are returned in `diagnostics` arrays, never thrown.
Each diagnostic carries:

```ts
interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;       // FM001, L001, P005, N002, V003, ...
  message: string;
  range: { start: Position; end: Position };
}
```

Code prefixes: `FM` frontmatter, `L` lexer, `P` parser, `N` normalizer, `V` validator.

## Validation rules

- **V001** Each artifact must have at most one producing process (single source).
- **V002 / V003** Every process must have ≥1 input and ≥1 output.
- **V004 – V006** `parts:` declarations must reference processes, must not self-reference, and must not form cycles.

## Canonical ordering

`sortEdges` produces a stable order independent of input ordering:

1. Connected component (by smallest node ID in component)
2. Topological rank (longest path from a source artifact)
3. Edge kind (`input` < `feedback` < `output`)
4. Lexicographic tiebreak

This makes `format()` output suitable for diffing and version control.

## Development

```bash
pnpm install
pnpm --filter @pfdsl/core build
pnpm --filter @pfdsl/core test
pnpm --filter @pfdsl/core typecheck
```

## Frontmatter JSON Schema

The package includes a generated Draft 2020-12 JSON Schema for authored, non-empty frontmatter mappings:

```js
const schema = require("@pfdsl/core/frontmatter.schema.json");
```

It accepts empty node declarations and extension data, and checks field types, enum values, style keys, and positive integer indices. Extract the YAML frontmatter before applying it to a `.pfdsl` document; the schema does not validate the DSL body. Graph references, cycles, field placement, and cross-node uniqueness still require `pfdsl check`.

Declaration IDs must be YAML strings: use `"10":`, not `10:`. JSON Schema sees parsed object keys, so use `pfdsl check` to verify original YAML key types before conversion.

The Zod definitions are the source of truth. The checked-in copy is `schema/frontmatter.schema.json`; regenerate it with `pnpm --filter @pfdsl/core build` followed by `pnpm --filter @pfdsl/core gen:schema`. Build also writes the packaged copy to `dist/frontmatter.schema.json`. Tests detect drift between the definitions and the checked-in JSON. JSON Schema conversion is not imported by the core runtime entry.
