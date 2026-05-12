# PFDSL — VSCode Extension

VSCode language support for [PFDSL](https://github.com/takasek/pfdsl), a DSL for describing Process Flow Diagrams as code.

## Features

- **Syntax highlighting** — TextMate grammar; YAML embedded in frontmatter
- **Inline diagnostics** — parse / normalize / validate errors in real time
- **Hover** — metadata for artifacts and processes (label, owner, status, tags, parts)
- **Format Document** (`pfdsl.format`) — canonical edge-list formatting
- **Live preview** (`pfdsl.preview`) — SVG rendered via Graphviz Wasm, refreshes on edit; open with the preview icon in the editor title bar
- **Export** (`pfdsl.export`) — save as `.dot` or `.svg`
- **Show Normalized Edges** (`pfdsl.normalize`) — canonical edge list in the Output panel

## Usage

Open any `.pfdsl` file. The preview icon appears in the editor title bar — click it to open a side-by-side SVG preview.

```pfdsl
[requirement, constraint] >> design -> spec
spec >>? design
[spec, codebase] >> implement -> code
code >> review -> review_report
```

## Development

```bash
pnpm --filter @pfdsl/vscode-extension build
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.
