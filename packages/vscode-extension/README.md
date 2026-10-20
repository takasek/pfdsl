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

Place the cursor on a node ID in the graph body or its frontmatter definition key, then run **PFDSL: Cycle Node Occurrences** from the editor context menu or press **Ctrl+K Ctrl+Alt+N** (**⌘+K ⌘+Alt+N** on macOS).
The command selects and reveals the definition key, then every body occurrence in document order, and wraps back to the definition.
Starting from a body occurrence advances to the next occurrence; repeating the command uses the current edited document.
Quoted definition keys work, and metadata field names such as another node's `status` do not identify nodes.
Without a definition it cycles through the body only; without body occurrences it stays on the definition.
Alias-only or ambiguous definition ranges do not identify a unique authored node key, so cycling uses body occurrences only for those IDs.

**PFDSL: Go to Frontmatter Definition** still jumps directly to the definition, using **Ctrl+K Ctrl+Alt+D** (**⌘+K ⌘+Alt+D** on macOS) or the editor context menu.
It preserves the existing target at an alias use site when the definition comes from an aliased section.
Both shortcuts apply while a PFDSL editor has text focus.
The extension no longer assigns Alt+F12, which is VS Code's [default Peek Definition shortcut on Windows and macOS](https://code.visualstudio.com/docs/reference/default-keybindings).
Cmd/Ctrl+Click keeps VS Code's existing [definition and multiple-cursor behavior](https://code.visualstudio.com/docs/editing/codebasics#_multicursor-modifier), controlled by `editor.multiCursorModifier`.

The first visible preview fits the complete diagram, without enlarging a small diagram.
Use **Fit** to see the whole diagram again, **Actual size** for its original size, or **− / +** to zoom around the viewport center.
The toolbar shows the current zoom level; **Help** lists the gestures.
Wheel to zoom at the pointer, drag the diagram to pan, and click or drag the minimap to move.
Double-click a node to go to its source; double-click the background to return to 100%.
Editing and error recovery preserve your zoom and pan; syntax and rendering errors appear separately at normal text size with the minimap hidden.

For an undefined node, **Insert artifact/process definition** in Quick Fix inserts its frontmatter definition and selects the new label for editing.
A produced artifact should also declare meaningful completion `criteria` (W002 warns when absent; strict validation treats it as an error).
The Quick Fix keeps that diagnostic until you supply a criterion, and the insertion can be undone in one step.

Click anywhere inside a preview node, or focus it with Tab and press Enter, to open **Connections**.
Right-click remains available; dragging pans without opening the panel, and Cmd/Ctrl+click opens a location or subflow without opening Connections.
Artifacts have square outlines and processes have rounded outlines; feedback connections use dashed gray lines.
Opening Connections with the pointer preserves focus; Enter on a node focuses the first heading action without opening candidates.
Focus or click **Connect a node…** to browse available candidates; use arrow keys and Enter to select one.
Unavailable and already connected candidates are hidden; feedback candidates appear when a normal input would create a cycle.
Adding a candidate keeps input focus and reopens the refreshed list.
Click or right-click a connection line for a menu beside it; use arrow keys to choose an action and Escape to return to the line.
Output connections offer **Delete** only; input connections also offer **Make feedback** or **Remove feedback**.
Deleting or switching a connection returns focus nearby on the same side without opening candidates.
The bottom panel shows direct incoming neighbors on the left, the current node in the center, and outgoing neighbors on the right.
Each neighbor list scrolls independently; the center and connection inputs remain visible.
For an undefined node, **Create definition** inserts its frontmatter entry and selects the label in the editor.
For a defined node, **Go to definition** moves to its definition and focuses the editor.
Focus either **Connect a node…** input to filter compatible existing nodes by ID or label, then select a candidate to connect it on that side.
Use the adjacent **+** to explicitly create and connect a new node with the entered ID as its initial label; pressing Enter in the input does not create a node.
Right-click a connection line to delete just that edge or switch an artifact-to-process input between normal and feedback.
Output connections cannot become feedback; duplicate connections, new cycles and additional producers are refused with a reason.
Each edit is one Undo step; a menu from an older document revision refuses to apply.

Hover over a node to read its text information; long information can be scrolled or focused with the keyboard.
Click a neighbor in **Connections** to center it in the main preview, update the panel and move the editor cursor while keeping focus in Connections.
Selecting a node ID in the editor, by double-clicking it or through a command such as Go to definition, updates the diagram and any open Connections panel without leaving the editor; it does not open a closed panel.
Preview edits preserve the panel's current node even when applying an edit moves the editor cursor.
This navigation and editor selections briefly outline the destination; redraws preserve position without repeating the cue.
Press Escape to close the hover or Connections; Escape in a candidate list closes only the candidates and retains the input.

```pfdsl
[requirement, constraint] >> design -> spec
spec >>? design
[spec, codebase] >> implement -> code
code >> review -> review_report
```

In the preview, Cmd+click (macOS) or Ctrl+click opens a node's local location or subflow source in the editor.
URL locations open through their URL handler.
Double-click jumps to the node in the source.
Each preview stays attached to its own file; to view an opened subflow, run **PFDSL: Open Preview to the Side** from that child file.

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
