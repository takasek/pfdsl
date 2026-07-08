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
- **CLI** — `pfdsl check / fmt / reindex / sort-meta / normalize / graph / diff` (`@pfdsl/cli`)
- **VSCode extension** — syntax highlighting, diagnostics, hover, document formatter, live SVG preview (`@pfdsl/vscode-extension`)
- **Claude Code skill** — syntax reference, CLI guidance, workflow for editing `.pfdsl` files (`.claude/skills/pfdsl/`); installable cross-project via `gh skill install takasek/pfdsl pfdsl --agent claude-code`


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
  check <file|-> [--audit] [--summary] [--strict] [--json] [--no-color]
                           Validate a .pfdsl file (- = stdin)
                           --audit    list terminal artifacts, external inputs, and consumer asymmetry hints
                           --summary  print artifact/process/edge counts
                           --strict   error if feedback source not reachable from target process
                           --json     output diagnostics as JSON
                           --no-color disable ANSI color codes (also: NO_COLOR env var)
  fmt <file|-> [--write] [--mode flat|flows]
                           Format a .pfdsl file (- = stdin)
  reindex <file|-> [--write] [--check] [--renumber] [--json]
                           Assign topological index: values (- = stdin)
                           --write     rewrite in place; report to stdout
                           --check     exit 1 if reindexing would change anything
                           --renumber  reassign every node from 1
                           --json      emit change report as JSON
  sort-meta <file|-> --by <keys> [--write] [--check]
                           Sort node definitions by keys (- = stdin)
                           --by        comma-separated: index, topological, group, id
                           --write     rewrite in place
                           --check     exit 1 if not already sorted
  normalize <file|-> [--json]
                           Print canonical edge list (- = stdin)
                           --json     output edge list as JSON array
  graph <file|-> [--format dot|svg|pdf|png]
                           Print Graphviz DOT (default), SVG, PDF, or PNG (- = stdin)
                           PDF/PNG requires: npm install puppeteer
  diff <a> <b> [--format text|dot|svg]
                           Structural diff (text), or visual diff DOT/SVG
  ready <file|-> [--best] [--json]
                           List ready-to-start processes (- = stdin)
                           --best    recommend the best next process
                           --json    output as JSON
  status-set <file> <artifact-id> <status> [--json]
                           Set artifact status (todo|wip|done|waiting|suspended) in place
                           Roadmap files: prints newly-ready processes after the change
                           --json    output as JSON ({ ok, newlyReady: string[], warnings? })
  audit-sync <roadmap> <flow> [<flow>...] [--json]
                           Cross-check todo artifacts in flow files against the roadmap
                           --json    output as JSON
  skill sync [--yes]
                           Sync pfd-ops skills and commands into the current directory
                           --yes     auto-confirm gh label creation (non-interactive)
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

To regenerate after spec or sample changes:

```bash
make gen-skill
# or install elsewhere:
node scripts/gen-skill.mjs --out ~/.claude/skills/pfdsl
```

The `--out` path must contain `/.claude/` (safety check). The script copies `docs/spec/spec.md` and `docs/samples/` into `references/` alongside `SKILL.md`.

## pfd-cycle suite — `skill sync` (cross-project)

A suite of Claude Code skills and commands for **PFD-driven project operations**: issue prioritization, progress tracking, artifact management, and session-learning routing across `roadmap` / `workflow` / `runtime-pipeline` PFDs. Use `/pfd-init` to bootstrap a new project's `.pfdsl/`, `/pfd-cycle` to run a work cycle, and `/pfd-retro` to audit and improve the process.

Install into any repo with one command:

```bash
npx @pfdsl/cli@latest skill sync
```

> **Tip:** `npx` re-installs on every invocation. For faster `check` / `ready` runs in daily use, install once:
> ```bash
> npm install -g @pfdsl/cli          # global
> npm install --save-dev @pfdsl/cli  # or as a devDependency
> ```

Run at a target repo's root, it is idempotent and:

- mirrors skills into `.claude/skills/` (`pfd-ops`, `pfd-retro`, `pfd-ecosystem`, `pfdsl`)
- copies commands into `.claude/commands/` (`pfd-init`, `pfd-cycle`, `pfd-retro`)
- refreshes the GitHub-Issues backend (`install/`: workflows + audit scripts deployed at repo root) **only if already adopted**; otherwise prints how to adopt it (`cp -r .claude/skills/pfd-ops/install/. .`)

`--yes` auto-confirms `gh` label creation (`flow:managed` / `flow:exempt`) for non-interactive use.

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
