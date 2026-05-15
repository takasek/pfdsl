# VSCode Extension: pfdsl diff integration

## Overview

`pfdsl.diff` command compares the current `.pfdsl` file against a git ref or another file. Structural diff (added/removed nodes and edges) is shown as a text panel at the bottom of the existing preview panel.

## Component Changes

### `@pfdsl/core`

Add to `packages/core/src/`:

```ts
export interface DiffReport {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  addedFeedback: string[];
  removedFeedback: string[];
}

export function diffGraphs(a: Graph, b: Graph): DiffReport
```

Refactor `packages/cli/src/index.ts`: delegate diff computation to core, keep file-loading logic in CLI.

### `packages/vscode-extension/src/diff.ts` (new)

`registerDiff(context)` registers two commands:

- **`pfdsl.diff`** — opens preview if not open, then shows QuickPick:
  1. `Compare with git ref...` — `showInputBox` with default value `HEAD`; runs `git show <ref>:<relative-path>`; errors if not a git repo or ref/file not found
  2. `Compare with file...` — `showOpenDialog` with `.pfdsl` filter; aborted on cancel
  
  After resolving both sides: `analyzeDocument(doc)` → Graph; `analyze(otherContent)` → Graph; `diffGraphs(a, b)` → `DiffReport`; post `{ type: "diff", report }` to preview panel.

- **`pfdsl.clearDiff`** — posts `{ type: "clearDiff" }` to preview panel.

### `packages/vscode-extension/src/preview.ts`

- Add `diffReport?: DiffReport` to `PreviewState`
- Extend `MessageToWebview`:
  ```ts
  | { type: "diff"; report: DiffReport }
  | { type: "clearDiff" }
  ```
- Export `getPreviewPanel(): PreviewState | null` so `diff.ts` can post messages to the active panel

### `packages/vscode-extension/src/webview.ts`

- Handle `diff` message: render text panel below SVG showing `+ node X`, `- node Y`, `+ edge A → B`, etc.
- Handle `clearDiff` message: hide the diff panel.
- Diff panel persists across re-renders (re-attached on each `render` message if `diffReport` is present in state).

### `packages/vscode-extension/src/extension.ts`

Add `registerDiff(context)` call.

### `packages/vscode-extension/package.json`

```json
{ "command": "pfdsl.diff",      "title": "PFDSL: Diff..." },
{ "command": "pfdsl.clearDiff", "title": "PFDSL: Clear Diff" }
```

## Data Flow

```
pfdsl.diff
  → QuickPick (git ref | file)
  → resolve content (git show <ref>:<path> | fs.readFileSync)
  → analyzeDocument(currentDoc) → Graph A
  → analyze(otherContent)       → Graph B
  → diffGraphs(A, B)            → DiffReport
  → previewPanel.webview.postMessage({ type: "diff", report })
  → webview renders text panel
```

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Not a git repo | `showErrorMessage("Not a git repository")` |
| Ref not found / file not in ref | `showErrorMessage("File not found at <ref>")` |
| Parse error in other file | `showErrorMessage("Failed to parse: <message>")` |
| No diff (identical) | Text panel shows "No structural differences" |
| QuickPick / dialog cancelled | Silent abort |

## Testing

- `@pfdsl/core`: unit tests for `diffGraphs` — added/removed nodes, edges, feedback edges, empty diff
- `@pfdsl/cli`: existing diff tests updated to use core function (regression coverage)
- VSCode extension WebView messaging: manual verification only (low ROI for unit tests)
