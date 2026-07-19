# @pfdsl/cli

Command-line interface for the [PFDSL](https://github.com/takasek/pfdsl) toolchain.

## Requirements

Node.js ≥ 18 (ESM only).

## Installation

```sh
npm install -g @pfdsl/cli
```

## Commands

| Command | Description |
|---|---|
| `pfdsl check <file>` | Validate a `.pfdsl` file |
| `pfdsl explain <code>` | Print the summary and spec section for a diagnostic code |
| `pfdsl fmt <file>` | Format a `.pfdsl` file |
| `pfdsl render <file>` | Export a diagram (DOT / SVG / PDF / PNG) |
| `pfdsl diff <file> <file>` | Compare two `.pfdsl` files |

### `graph` — read-only queries on the graph topology

| Command | Description |
|---|---|
| `pfdsl graph summary` | Print node/edge counts and per-group breakdown |
| `pfdsl graph io` | List terminal artifacts and external inputs |
| `pfdsl graph stats` | Print graph-wide structural stats |
| `pfdsl graph neighbors <id>` | List direct neighbors of a node |
| `pfdsl graph impact <id>` | List nodes reachable downstream of a node |
| `pfdsl graph depends-on <id>` | List nodes reachable upstream of a node |
| `pfdsl graph path <from> <to>` | Print a path between two nodes |
| `pfdsl graph edges <file>` | Print normalized edge list |

### `meta` — read and write frontmatter metadata

| Command | Description |
|---|---|
| `pfdsl meta get <file> <id[,id...]> [field[,field...]]` | Print frontmatter field values |
| `pfdsl meta set <file> <id[,id...]> <field> <value>` | Set a scalar frontmatter field in place |
| `pfdsl meta sort <file>` | Sort frontmatter node definitions by key |
| `pfdsl meta reindex <file>` | Number nodes' `index:` in topological order |

### `status` — planning queries derived from artifact status

| Command | Description |
|---|---|
| `pfdsl status ready <file>` | List processes ready to start |
| `pfdsl status gaps <roadmap> <flow>...` | Report gaps between a roadmap and its flow files |

Run `pfdsl --help` or `pfdsl <command> --help` for full usage and exit codes.
