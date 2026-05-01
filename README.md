# PFDSL — Process Flow DSL

A small DSL for describing process flows as artifacts (deliverables) and
processes (activities), and the input/output edges between them. Sources
parse to a canonical edge list that can be re-emitted, validated, and (in
later phases) rendered to Graphviz / VSCode preview.

```pfdsl
[requirement, constraint] >> design -> spec
spec >>? design                       # feedback loop
[spec, codebase] >> implement -> code
code >> review -> review_report
```

## Status

**Phase 1 (core library) — complete.** The `@pfdsl/core` package provides
the full pipeline: lexer → parser → normalizer → graph builder → validator
→ canonical sorter → formatter, plus a public `format()` entry point.

Phase 2+ (Graphviz exporter, CLI wrapper, VSCode extension) is planned but
not yet implemented. See [docs/superpowers/plans/](docs/superpowers/plans/).

## Repo layout

```
packages/core/    @pfdsl/core — DSL pipeline (parse / validate / format)
docs/spec/        Language specification (spec.md)
docs/             ADRs, plans, sample .pfdsl files
```

## Quick start

```bash
pnpm install
pnpm -r build
pnpm -r test       # 85 tests across the core package
pnpm -r typecheck
```

## Using the library

See [packages/core/README.md](packages/core/README.md) for API and DSL
reference.

```ts
import { format } from '@pfdsl/core';

const { output, diagnostics } = format(`
[a, b] >> proc -> result
result >>? proc
`);

console.log(output);
// a >> proc
// b >> proc
// result >>? proc
// proc -> result
```

## Spec

Language specification: [docs/spec/spec.md](docs/spec/spec.md).

Key syntax:
- `A >> P -> B` — A is input to process P, B is output of P
- `[a, b] >> P` — set notation (Cartesian product over edges)
- `R >>? P` — feedback edge (does not affect rank/topology)
- `A >> P -> B >> Q -> C` — chain (multi-segment statement)
- `# ...` — comment to end of line
- Trailing tokens (`<id>` or `]`) may be followed by a single newline (and
  optional comment lines) before a continuation operator (`>>`, `>>?`,
  `->`); blank lines force statement termination.
