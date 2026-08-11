# @pfdsl/cli

Command-line interface for the [PFDSL](https://github.com/takasek/pfdsl) toolchain.

## Requirements

Node.js ≥ 18 (ESM only).

## Installation

```sh
npm install -g @pfdsl/cli
```

## Commands

<!-- gen-readme-cli:start -->

| Command | Description |
|---|---|
| `pfdsl check <file\|-> [--strict] [--hints] [--json] [--no-color]` | Validate a .pfdsl file (- = stdin) |
| `pfdsl explain <code>` | Print the summary and spec section for a diagnostic code (e.g. V021) |
| `pfdsl fmt <file\|-> [--write] [--check] [--no-color]` | Format a .pfdsl file (- = stdin) |
| `pfdsl render <file\|-> [--format dot\|svg\|pdf\|png] [--no-color]` | Render as Graphviz DOT (default), SVG, PDF, or PNG (- = stdin) PDF/PNG requires puppeteer in the CLI's own Node env (npm install puppeteer) |
| `pfdsl diff <a> <b> [--format text\|dot\|svg] [--json] [--no-color]` | Structural diff (text), or visual diff DOT/SVG |

### `graph` — Read-only queries on the graph topology

| Command | Description |
|---|---|
| `pfdsl graph summary <file\|->` | Print artifact/process/edge counts |
| `pfdsl graph io <file\|->` | Print external inputs and terminal artifacts |
| `pfdsl graph stats <file\|-> [--limit]` | Rank nodes by primary degree, feedback degree apart |
| `pfdsl graph neighbors <file\|-> <id>` | Direct predecessors/successors of a node, feedback included |
| `pfdsl graph locate <file\|-> <id>` | Frontmatter declaration line and body edge lines of a node |
| `pfdsl graph describe <file\|-> <id>` | Kind, fields, neighbors, and locate lines of a node, in one call |
| `pfdsl graph impact <file\|-> <id>` | Full downstream closure of a node |
| `pfdsl graph depends-on <file\|-> <id>` | Full upstream closure of a node |
| `pfdsl graph path <file\|-> <from> <to> [--limit]` | All simple paths between two nodes |
| `pfdsl graph edges <file\|->` | Canonical edge list |
| `pfdsl graph orphans <file\|->` | Nodes with neither predecessor nor successor |

### `meta` — Read and write frontmatter metadata

| Command | Description |
|---|---|
| `pfdsl meta get <file\|-> <id[,id...]> [field[,field...]]` | Print field values |
| `pfdsl meta list <file\|-> [--tag\|--group\|--producer] [field[,field...]]` | Print field values for nodes matching selectors |
| `pfdsl meta values <file\|-> <field[,field...]>` | Print a field's values in use, with counts |
| `pfdsl meta set <file> <id> <field> <value>` | Set a field value in place |
| `pfdsl meta sort <file\|-> --by <keys>` | Sort node definitions |
| `pfdsl meta reindex <file\|->` | Assign topological index: values |
| `pfdsl meta check-links <file>` | Verify location: file paths exist |

### `status` — Planning queries derived from artifact status

| Command | Description |
|---|---|
| `pfdsl status ready <file\|-> [--best]` | List ready-to-start processes |
| `pfdsl status blocked <file\|->` | List not-ready processes and their blocking inputs |
| `pfdsl status list <file\|-> --status <s[,s...]>` | List artifacts by status |
| `pfdsl status gaps <roadmap> <flow> [<flow>...]` | Find todo artifacts missing from the roadmap |

<!-- gen-readme-cli:end -->

Run `pfdsl --help` or `pfdsl <command> --help` for full usage and exit codes.
