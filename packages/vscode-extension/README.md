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

From the repo root (a **worktree** root if you use one — not the main checkout, or you debug stale code):

```bash
make vscode-dev
```

This builds the extension and its `@pfdsl/*` deps, opens `packages/vscode-extension` as its own VS Code window, and then watches for changes in the foreground (Ctrl+C to stop). Press `F5` in that window to launch an Extension Development Host with the extension loaded. F5 is backed by a committed `.vscode/launch.json` whose `preLaunchTask` rebuilds `dist/`, so the Dev Host always loads fresh code regardless of which worktree you opened.

While `make vscode-dev` keeps running, edit a source file and reload the Dev Host (`Cmd+R`) to pick up the rebuilt `dist/` — no need to stop and restart.

To verify a change in the Dev Host: open a `.pfdsl` file, then run **PFDSL: Open Preview to the Side** (the PFDSL preview, not VS Code's Markdown preview). When inspecting the webview console, filter by `takasek.pfdsl` to cut out unrelated extension noise.

If F5 does nothing, you almost certainly opened a folder other than `packages/vscode-extension` — VS Code only reads `.vscode/launch.json` from the workspace root.
