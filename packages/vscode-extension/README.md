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

The first visible preview fits the complete diagram, without enlarging a small diagram.
Use **Fit** to see the whole diagram again, **100%** for its original size, or **− / +** to zoom around the viewport center.
The toolbar shows the current zoom level; **Help** lists the gestures.
Wheel to zoom at the pointer, drag the diagram to pan, and click or drag the minimap to move.
Double-click a node to go to its source; double-click the background to return to 100%.
Ctrl+Click (⌘+Click on macOS) opens a node's location or subflow when available.
Editing and error recovery preserve your zoom and pan; syntax and rendering errors appear separately at normal text size with the minimap hidden.

For an undefined node, **Insert artifact/process definition** in Quick Fix inserts its frontmatter definition and selects the new label for editing.
A produced artifact should also declare meaningful completion `criteria` (W002 warns when absent; strict validation treats it as an error).
The Quick Fix keeps that diagnostic until you supply a criterion, and the insertion can be undone in one step.

```pfdsl
[requirement, constraint] >> design -> spec
spec >>? design
[spec, codebase] >> implement -> code
code >> review -> review_report
```

## Development

From the repo root (a **worktree** root if you use one — not the main checkout, or you debug stale code):

```bash
make setup
make vscode-dev
```

VS Code's `code` command must be available on your PATH before starting the development session.

This builds the extension and its `@pfdsl/*` deps, opens `packages/vscode-extension` as its own VS Code window, and then watches for changes in the foreground (Ctrl+C to stop). Press `F5` in that window to launch an Extension Development Host with the extension loaded. F5 is backed by a committed `.vscode/launch.json` whose `preLaunchTask` rebuilds `dist/`, so the Dev Host always loads fresh code regardless of which worktree you opened.

While `make vscode-dev` keeps running, edit a source file and reload the Dev Host (`Cmd+R`) to pick up the rebuilt `dist/` — no need to stop and restart.

To verify a change in the Dev Host: open a `.pfdsl` file, then run **PFDSL: Open Preview to the Side** (the PFDSL preview, not VS Code's Markdown preview). When inspecting the webview console, filter by `takasek.pfdsl` to cut out unrelated extension noise.

If F5 does nothing, you almost certainly opened a folder other than `packages/vscode-extension` — VS Code only reads `.vscode/launch.json` from the workspace root.

## Webview smoke tests

Run `make test-vscode-smoke` from the repository worktree root.
The command downloads the pinned VS Code test binary on first use, starts it with an isolated profile, and verifies preview rendering, zoom, pan, minimap interaction, outside release, and node navigation through the real webview.
Failures report the VS Code version, process stdout and stderr, bounded extension-host log tails from the isolated profile, webview frame URLs, last observed readiness data, and selected-frame semantic DOM state.
The smoke test does not compare screenshots or cover OS-native dialogs, IME input, or the Marketplace-installed extension.
