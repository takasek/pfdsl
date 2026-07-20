# PFDSL — Process Flow DSL

A small DSL for describing process flows as artifacts and processes, and the input/output edges between them. Sources parse to a canonical edge list that can be re-emitted, validated, diffed, and rendered to Graphviz (DOT or SVG).

```pfdsl
[requirement, constraint] >> design -> spec
spec >>? design                       # feedback loop
[spec, codebase] >> implement -> code
code >> review -> review_report
```

![](docs/readme-example.svg)

## Spec

Language specification: [docs/spec/spec.md](docs/spec/spec.md)

Key syntax:
- `A >> P -> B` — A is input to process P, B is output of P
- `[a, b] >> P` — set notation (Cartesian product over edges)
- `R >>? P` — feedback edge (does not affect rank/topology)
- `A >> P -> B >> Q -> C` — chain (multi-segment statement)
- `# ...` — comment to end of line
- Trailing tokens (`<id>` or `]`) may be followed by a single newline (and optional comment lines) before a continuation operator (`>>`, `>>?`, `->`); blank lines force statement termination.

## Artifact status & tags (DOT styling)

Annotate artifacts with progress `status` (enum) and free-form `tags`, then map them to DOT node attributes via frontmatter.

```pfdsl
---
artifact:
  spec:
    status: done
    tags: [external, critical]
  impl:
    status: wip
statusStyles:
  done: { fillcolor: lightgray, style: filled }
  wip:  { fillcolor: lightyellow, style: filled }
tag:
  external: { label: External, style: { color: blue } }
  critical: { style: { penwidth: "3" } }
---
spec >> P -> impl
```

- `status` ∈ `done | wip | todo | waiting | suspended` (one per artifact, artifact-only)
- `tags` — arbitrary string array on **artifacts and processes**; undeclared tags are silently ignored
- `tag:` block declares per-tag `label` / `description` / `style` (parallel to `group:`)
- Allowed style attrs: `fillcolor | color | fontcolor | style | penwidth`
- Apply order: `tags` reverse-merge (first tag wins) → `statusStyles` overrides last (`status` artifact-only)

See [docs/spec/spec.md §2.7](docs/spec/spec.md) for full rules.

## `index:` field (external tool numbering)

Artifacts and processes accept an optional `index:` integer. `pfdsl reindex` auto-assigns values in topological order; external tools (e.g. pfd-tools) read them as `D{index}` / `P{index}`. See [docs/spec/spec.md §2.3](docs/spec/spec.md) for constraints.

## Samples

Feature-by-feature syntax examples with rendered `.dot` and `.svg`: [docs/samples/](docs/samples/README.md).

## Features

- **Pipeline** — lexer → parser → normalizer → validator → canonical sorter → formatter (`@pfdsl/core`)
- **DOT / SVG** — Graphviz export and Wasm-based rendering (`@pfdsl/graphviz-exporter`, `@pfdsl/preview-engine`)
- **CLI** — `pfdsl check / fmt / render / diff` plus `graph` / `meta` / `status` command groups (`@pfdsl/cli`)
- **VSCode extension** — syntax highlighting, diagnostics, hover, document formatter, live SVG preview (`@pfdsl/vscode-extension`)
- **Claude Code skill** — syntax reference, CLI guidance, workflow for editing `.pfdsl` files (`.claude/skills/pfdsl/`); installable via `/plugin marketplace add takasek/pfdsl` + `/plugin install pfdsl@pfdsl`


## Quick start

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm -r typecheck
```

## CLI

```bash
npm install -g @pfdsl/cli
pfdsl --help
pfdsl --version
```

For development (from this repo after `pnpm -r build`):

```bash
node packages/cli/dist/cli.js help
```

<!-- gen-readme-cli:start -->

```bash
pfdsl <command> [options]

Commands:
  check <file|-> [--strict] [--hints] [--json] [--no-color]
                           Validate a .pfdsl file (- = stdin)
  explain <code>           Print the summary and spec section for a diagnostic code (e.g. V021)
  fmt <file|-> [--write] [--check]
                           Format a .pfdsl file (- = stdin)
  render <file|-> [--format dot|svg|pdf|png]
                           Render as Graphviz DOT (default), SVG, PDF, or PNG (- = stdin)
                           PDF/PNG requires: npm install puppeteer
  diff <a> <b> [--format text|dot|svg] [--json]
                           Structural diff (text), or visual diff DOT/SVG

Command groups (run `pfdsl <group>` for their subcommands):
  graph summary|io|stats|neighbors|impact|depends-on|path|edges|orphans
                           Read-only queries on the graph topology
  meta get|set|sort|reindex|check-links
                           Read and write frontmatter metadata
  status ready|blocked|list|gaps
                           Planning queries derived from artifact status

  help                     Show this help

Exit codes:
  0  success (warnings are non-fatal)
  1  error (parse/validation error, or file cannot be read)
  2  invalid usage (missing argument, unknown flag or subcommand)
```

<!-- gen-readme-cli:end -->

## VSCode extension

See [packages/vscode-extension/README.md](packages/vscode-extension/README.md) for full feature docs.

```bash
pnpm --filter @pfdsl/vscode-extension build
```

Open the repo in VS Code and press `F5` to launch an Extension Development Host with `@pfdsl/vscode-extension` loaded. In the host, `.pfdsl` files get:

- syntax highlighting (TextMate grammar; YAML embedded in frontmatter)
- inline diagnostics (parse / normalize / validate)
- hover metadata for artifacts and processes (label, owner, status, tags, parts)
- `Format Document` / `pfdsl.format`
- `PFDSL: Open Preview to the Side` (`pfdsl.preview`) — live SVG, refreshes on edit

## Claude Code skill

A skill for Claude Code is bundled at `.claude/skills/pfdsl/`. It provides PFDSL syntax reference, CLI command guidance, and workflow steps for editing `.pfdsl` files. Claude Code picks it up automatically when working in this repo.

### Install via Claude Code plugin marketplace (recommended)

The `pfdsl`, `pfd-ecosystem`, `pfd-retro`, and `pfd-ops` skills, plus the `/pfd-cycle` and `/pfd-init` commands, are distributed as a Claude Code plugin (`plugin/pfdsl/`) through this repo's self-hosted marketplace:

```
/plugin marketplace add takasek/pfdsl
/plugin install pfdsl@pfdsl
```

Skills and commands are namespaced under the plugin: `pfdsl:pfdsl`, `pfdsl:pfd-ecosystem`, `pfdsl:pfd-retro`, `pfdsl:pfd-ops`, `/pfdsl:pfd-cycle`, `/pfdsl:pfd-init`. Updates ship by bumping the CLI version (`plugin.json`'s `version` field is derived from `packages/cli/package.json`); `/plugin marketplace update` picks up new releases.

`pfd-ops` ships repo-side automation (GitHub Actions workflows, audit scripts) that the plugin mechanism can't write into your project directly, so adopting it is a separate step — see the section below.

### Regenerating the skill (contributors)

After changing `docs/spec/spec.md`, `docs/samples/`, or the skill template, regenerate the in-repo dev copy:

```bash
make gen-skill
```

The script copies `docs/spec/spec.md` and `docs/samples/` into `references/` alongside `SKILL.md`. `make gen-plugin` (which depends on `gen-skill`) regenerates the marketplace plugin's copy too.

## pfd-cycle suite (cross-project)

A suite of Claude Code skills and commands for **PFD-driven project operations**: issue prioritization, progress tracking, artifact management, and session-learning routing across `roadmap` / `workflow` / `runtime-pipeline` PFDs.

Adopt it in any repo through the plugin:

```
/plugin marketplace add takasek/pfdsl
/plugin install pfdsl@pfdsl
/pfd-init
```

`/pfd-init` copies the `.pfdsl/` scaffold for the PFD kinds your project needs, and (optionally, step 3.5) deploys the GitHub-Issues backend automation — workflows and audit scripts — to the repo root, via the `check-install-sync.mjs` script bundled with the `pfd-ops` skill. Running it again refreshes an already-adopted repo: locally edited files are warned about rather than overwritten, unless you pass `--force`.

Once adopted, use `/pfd-cycle` to run a work cycle and `/pfd-retro` to audit and improve the process.

## Library

```sh
pnpm add @pfdsl/core
# SVG rendering (optional):
pnpm add @pfdsl/graphviz-exporter @pfdsl/preview-engine
```

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

One-shot pipeline (parse + normalize + validate + buildGraph) and SVG render:

```ts
import { analyze } from '@pfdsl/core';
import { renderGraph } from '@pfdsl/preview-engine';

const { graph, frontmatter, diagnostics } = analyze(source);
if (diagnostics.some(d => d.severity === 'error')) throw new Error('invalid source');
const svg = await renderGraph(graph, frontmatter, { format: 'svg' });
```

API reference: [packages/core/README.md](packages/core/README.md).

## Repo layout

```
packages/core/               @pfdsl/core              — DSL pipeline (parse / validate / format)
packages/graphviz-exporter/  @pfdsl/graphviz-exporter — Graph → DOT
packages/metadata-exporter/  @pfdsl/metadata-exporter — Graph → structured metadata (private, bundled into VSCode extension)
packages/preview-engine/     @pfdsl/preview-engine    — DOT → SVG (Graphviz wasm)
packages/cli/                @pfdsl/cli               — `pfdsl` CLI
packages/vscode-extension/   @pfdsl/vscode-extension  — VSCode language extension ([README](packages/vscode-extension/README.md))
docs/spec/                   Language specification (spec.md)
docs/samples/                Syntax samples — .pfdsl + .dot + .svg pairs
docs/                        ADRs, plans, roadmap
```
