# PFDSL — Process Flow DSL

A small DSL for describing process flows as artifacts (deliverables) and
processes (activities), and the input/output edges between them. Sources
parse to a canonical edge list that can be re-emitted, validated, diffed,
and rendered to Graphviz (DOT or SVG).

```pfdsl
[requirement, constraint] >> design -> spec
spec >>? design                       # feedback loop
[spec, codebase] >> implement -> code
code >> review -> review_report
```

## Status

**Phase 1 (core library) — complete.** `@pfdsl/core` provides the full
pipeline: lexer → parser → normalizer → graph builder → validator →
canonical sorter → formatter, plus the public `format()` entry point.

**Phase 2 (DOT export, preview, CLI) — complete.**
- `@pfdsl/graphviz-exporter` — `Graph` + `Frontmatter` → DOT.
- `@pfdsl/preview-engine` — wraps `@hpcc-js/wasm` Graphviz; renders DOT/SVG.
- `@pfdsl/cli` — `pfdsl` binary: `check` / `fmt` / `normalize` / `graph` / `diff`.

Phase 3 (VSCode extension) — planned. See [docs/superpowers/plans/](docs/superpowers/plans/).

## Repo layout

```
packages/core/               @pfdsl/core              — DSL pipeline (parse / validate / format)
packages/graphviz-exporter/  @pfdsl/graphviz-exporter — Graph → DOT
packages/preview-engine/     @pfdsl/preview-engine    — DOT → SVG (Graphviz wasm)
packages/cli/                @pfdsl/cli               — `pfdsl` CLI
docs/spec/                   Language specification (spec.md)
docs/                        ADRs, plans, sample .pfdsl files
```

## Quick start

```bash
pnpm install
pnpm -r build
pnpm -r test       # 113 tests across 4 packages
pnpm -r typecheck
```

## CLI

After `pnpm -r build`, run the CLI in one of these ways:

```bash
# Run directly (no install):
node packages/cli/dist/cli.js help

# Or add a shell alias (recommended for daily use):
echo "alias pfdsl='node $PWD/packages/cli/dist/cli.js'" >> ~/.zshrc
source ~/.zshrc
```

> Note: `pnpm link --global` from this workspace links the root package
> (named `pfdsl`) instead of `@pfdsl/cli`, so it does not expose the
> binary. Use the alias above, or rename the root package, if you want
> a global `pfdsl` command via pnpm.

```bash
pfdsl check <file>                    # validate
pfdsl fmt <file> [--write]            # format (stdout, or rewrite in place)
pfdsl normalize <file>                # canonical edge list
pfdsl graph <file> [--format dot|svg] # Graphviz DOT (default) or SVG
pfdsl diff <a> <b>                    # structural diff (nodes / edges / feedback)
pfdsl help
```

Exit codes: `0` ok, `1` validation/IO error, `2` usage error.

## Library

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

Render to SVG:

```ts
import { parse, normalizeDocument, buildGraph } from '@pfdsl/core';
import { renderGraph } from '@pfdsl/preview-engine';

const { document, frontmatter } = parse(source);
const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
const graph = buildGraph(edges, nodeKinds);
const svg = await renderGraph(graph, frontmatter, { format: 'svg' });
```

API reference: [packages/core/README.md](packages/core/README.md).

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
