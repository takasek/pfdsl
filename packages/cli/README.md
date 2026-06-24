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
| `pfdsl fmt <file>` | Format a `.pfdsl` file |
| `pfdsl graph <file>` | Export a diagram (DOT / SVG / PDF / PNG) |
| `pfdsl normalize <file>` | Print normalized edge list |
| `pfdsl diff <file> <file>` | Compare two `.pfdsl` files |

Run `pfdsl --help` or `pfdsl <command> --help` for full usage and exit codes.
