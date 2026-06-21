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

### Stage-by-stage API

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

- **V001** Each artifact must have at most one producing process (single
  source).
- **V002 / V003** Every process must have ≥1 input and ≥1 output.
- **V004 – V006** `parts:` declarations must reference processes, must not
  self-reference, and must not form cycles.

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
