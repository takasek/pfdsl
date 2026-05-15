# VSCode Diff Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pfdsl.diff` and `pfdsl.clearDiff` commands to the VSCode extension that show structural diff (added/removed nodes and edges) as a text panel at the bottom of the existing preview panel.

**Architecture:** Move graph-level `diffGraphs` into `@pfdsl/core` so the VSCode extension (which does not depend on `@pfdsl/cli`) can use it. The extension's `registerPreview` returns a `postDiff` callback, which `registerDiff` calls after resolving content from a git ref or a file.

**Tech Stack:** TypeScript, VSCode Extension API, `@pfdsl/core` (workspace package), Node.js `child_process.execSync` for git, `vitest` for tests.

---

### Task 1: Add `diffGraphs` to `@pfdsl/core` (TDD)

**Files:**
- Create: `packages/core/src/diff.ts`
- Create: `packages/core/src/diff.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { diffGraphs } from "./diff.js";

describe("diffGraphs", () => {
  it("reports no differences for identical graphs", () => {
    const g = analyze("req >> design -> spec\n").graph;
    const r = diffGraphs(g, g);
    expect(r.addedNodes).toEqual([]);
    expect(r.removedNodes).toEqual([]);
    expect(r.addedEdges).toEqual([]);
    expect(r.removedEdges).toEqual([]);
    expect(r.addedFeedback).toEqual([]);
    expect(r.removedFeedback).toEqual([]);
  });

  it("reports added nodes and edges", () => {
    const a = analyze("req >> design -> spec\n").graph;
    const b = analyze("req >> design -> spec\nspec >> impl -> code\n").graph;
    const r = diffGraphs(a, b);
    expect(r.addedNodes).toEqual(["code", "impl"]);
    expect(r.addedEdges).toContain("spec -> impl");
    expect(r.addedEdges).toContain("impl -> code");
    expect(r.removedNodes).toEqual([]);
    expect(r.removedEdges).toEqual([]);
  });

  it("reports removed nodes and edges", () => {
    const a = analyze("req >> design -> spec\nspec >> impl -> code\n").graph;
    const b = analyze("req >> design -> spec\n").graph;
    const r = diffGraphs(a, b);
    expect(r.removedNodes).toEqual(["code", "impl"]);
    expect(r.removedEdges).toContain("spec -> impl");
    expect(r.removedEdges).toContain("impl -> code");
    expect(r.addedNodes).toEqual([]);
    expect(r.addedEdges).toEqual([]);
  });

  it("reports added feedback edge", () => {
    const a = analyze("spec >> impl -> code\n").graph;
    const b = analyze("spec >> impl -> code\ncode >>? impl\n").graph;
    const r = diffGraphs(a, b);
    expect(r.addedFeedback).toEqual(["code -> impl"]);
    expect(r.removedFeedback).toEqual([]);
  });

  it("reports removed feedback edge", () => {
    const a = analyze("spec >> impl -> code\ncode >>? impl\n").graph;
    const b = analyze("spec >> impl -> code\n").graph;
    const r = diffGraphs(a, b);
    expect(r.removedFeedback).toEqual(["code -> impl"]);
    expect(r.addedFeedback).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/core test
```

Expected: FAIL — "Cannot find module './diff.js'"

- [ ] **Step 3: Implement `packages/core/src/diff.ts`**

```ts
import type { Graph } from "./types/index.js";

export interface DiffReport {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  addedFeedback: string[];
  removedFeedback: string[];
}

function edgeKey(from: string, to: string): string {
  return `${from} -> ${to}`;
}

function setDiff(lhs: Set<string>, rhs: Set<string>): string[] {
  return [...rhs].filter((x) => !lhs.has(x)).sort();
}

export function diffGraphs(a: Graph, b: Graph): DiffReport {
  const aNodes = new Set(a.nodes.keys());
  const bNodes = new Set(b.nodes.keys());
  const aEdges = new Set(a.primaryEdges.map((e) => edgeKey(e.from, e.to)));
  const bEdges = new Set(b.primaryEdges.map((e) => edgeKey(e.from, e.to)));
  const aFb = new Set(
    a.feedbackEdges.map((e) => edgeKey(e.artifact, e.process)),
  );
  const bFb = new Set(
    b.feedbackEdges.map((e) => edgeKey(e.artifact, e.process)),
  );
  return {
    addedNodes: setDiff(aNodes, bNodes),
    removedNodes: setDiff(bNodes, aNodes),
    addedEdges: setDiff(aEdges, bEdges),
    removedEdges: setDiff(bEdges, aEdges),
    addedFeedback: setDiff(aFb, bFb),
    removedFeedback: setDiff(bFb, aFb),
  };
}
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

Add after the last `export` line in the file:

```ts
export { diffGraphs } from "./diff.js";
export type { DiffReport } from "./diff.js";
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/core test
```

Expected: all tests pass.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/core typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/diff.ts packages/core/src/diff.test.ts packages/core/src/index.ts
git commit -m "feat(core): add diffGraphs and DiffReport"
```

---

### Task 2: Refactor CLI to use core's `diffGraphs`

**Files:**
- Modify: `packages/cli/src/index.ts`

The CLI currently defines its own `DiffReport` and `diffGraphs(fileA, fileB)`. Refactor to delegate graph-level diff to core. The public file-path API stays unchanged so existing tests pass.

- [ ] **Step 1: Run existing CLI diff tests (confirm green baseline)**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/cli test
```

Expected: all tests pass.

- [ ] **Step 2: Refactor `packages/cli/src/index.ts`**

In the `import` block at the top, add `diffGraphs as coreDiffGraphs` and `type DiffReport`:

```ts
import {
  analyze,
  type Diagnostic,
  diffGraphs as coreDiffGraphs,
  type DiffReport,
  format,
  formatEdges,
  hasErrors,
  sortEdges,
} from "@pfdsl/core";
```

Remove the local `DiffReport` interface (lines ~98–107) and the local `edgeKey` + `diff` helpers inside `diffGraphs`. Replace the body of the exported `diffGraphs` function:

```ts
export type { DiffReport };

export function diffGraphs(fileA: string, fileB: string): DiffReport {
  const a = loadGraph(fileA);
  const b = loadGraph(fileB);
  return coreDiffGraphs(a, b);
}
```

- [ ] **Step 3: Run CLI tests**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/cli test
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/cli typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "refactor(cli): delegate diffGraphs to @pfdsl/core"
```

---

### Task 3: Extend `preview.ts` — diff state and `postDiff` return

**Files:**
- Modify: `packages/vscode-extension/src/preview.ts`

Add `DiffReport` to state, flush pending diff in `sendUpdate`, add diff-panel CSS+div to HTML, and return a `postDiff` callback from `registerPreview`.

- [ ] **Step 1: Add `DiffReport` import**

At the top of `packages/vscode-extension/src/preview.ts`, add `DiffReport` to the `@pfdsl/core` import:

```ts
import type {
  AnalyzeResult,
  DiffReport,
  Frontmatter,
  IdNode,
  Statement,
} from "@pfdsl/core";
```

- [ ] **Step 2: Extend `PreviewState`**

Change the `PreviewState` interface to:

```ts
interface PreviewState {
  panel: vscode.WebviewPanel;
  doc: vscode.TextDocument;
  webviewReady: boolean;
  pendingFocusNodeId?: string;
  pendingDiff?: DiffReport | null;  // null = clearDiff
}
```

- [ ] **Step 3: Extend `MessageToWebview`**

Add two new variants:

```ts
type MessageToWebview =
  | {
      type: "render";
      dot: string;
      focusNodeId?: string;
      descriptions?: Record<string, string>;
    }
  | { type: "error"; message: string }
  | { type: "focus"; nodeId: string }
  | { type: "clearFocus" }
  | { type: "diff"; report: DiffReport }
  | { type: "clearDiff" };
```

- [ ] **Step 4: Flush `pendingDiff` in `sendUpdate`**

In `sendUpdate`, after the existing `postMessage` call (render or error), add:

```ts
if ("pendingDiff" in state) {
  const d = state.pendingDiff;
  delete state.pendingDiff;
  state.panel.webview.postMessage(
    d == null
      ? ({ type: "clearDiff" } satisfies MessageToWebview)
      : ({ type: "diff", report: d } satisfies MessageToWebview),
  );
}
```

- [ ] **Step 5: Add diff-panel CSS and div to `buildHtml`**

In `buildHtml`, update the `<style>` block and `<body>`:

Add to the `<style>` block (after existing rules):

```css
body { display: flex; flex-direction: column; }
#root { flex: 1; min-height: 0; overflow: hidden; cursor: grab; position: relative; }
#diff-panel { display: none; flex-shrink: 0; max-height: 200px; overflow-y: auto; padding: 6px 12px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); border-top: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-editor-background); }
.diff-add { color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50); white-space: pre; }
.diff-remove { color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336); white-space: pre; }
.diff-none { color: var(--vscode-descriptionForeground, #888); font-style: italic; }
```

Change `<body>` to:

```html
<body>
<div id="root"><div id="inner"></div></div>
<div id="tooltip"></div>
<div id="diff-panel"></div>
<script type="module" src="${scriptUri}"></script>
</body>
```

Also remove the original `#root` CSS rule that duplicates width/height/overflow (now handled by flex). The updated full style block should read:

```css
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
body { display: flex; flex-direction: column; }
#root { flex: 1; min-height: 0; overflow: hidden; cursor: grab; position: relative; }
#inner { position: absolute; top: 0; left: 0; }
.err { padding: 12px; color: var(--vscode-errorForeground); white-space: pre-wrap; font-family: var(--vscode-editor-font-family); }
#tooltip { position: fixed; background: var(--vscode-editorHoverWidget-background, #2d2d2d); color: var(--vscode-editorHoverWidget-foreground, #ccc); border: 1px solid var(--vscode-editorHoverWidget-border, #454545); padding: 4px 8px; border-radius: 3px; font-size: 12px; max-width: 320px; pointer-events: none; display: none; z-index: 100; white-space: pre-wrap; word-break: break-word; }
#diff-panel { display: none; flex-shrink: 0; max-height: 200px; overflow-y: auto; padding: 6px 12px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); border-top: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-editor-background); }
.diff-add { color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50); white-space: pre; }
.diff-remove { color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336); white-space: pre; }
.diff-none { color: var(--vscode-descriptionForeground, #888); font-style: italic; }
g.node.pfdsl-focused ellipse, g.node.pfdsl-focused polygon, g.node.pfdsl-focused path { filter: drop-shadow(0 0 5px currentColor); stroke-width: 2.5; }
```

- [ ] **Step 6: Return `postDiff` from `registerPreview`**

Change the signature and add the function:

```ts
export function registerPreview(context: vscode.ExtensionContext): {
  postDiff(report: DiffReport | null): void;
} {
```

Before the `return` (the `context.subscriptions.push(...)` block at the end), add:

```ts
  function postDiff(report: DiffReport | null): void {
    if (!current) return;
    if (current.webviewReady) {
      current.panel.webview.postMessage(
        report == null
          ? ({ type: "clearDiff" } satisfies MessageToWebview)
          : ({ type: "diff", report } satisfies MessageToWebview),
      );
    } else {
      current.pendingDiff = report;
    }
  }
```

And at the very end of `registerPreview`, after the `context.subscriptions.push(...)` block, add:

```ts
  return { postDiff };
}
```

- [ ] **Step 7: Typecheck**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/vscode-extension typecheck
```

Expected: no errors. (extension.ts will error until Task 6 — fix by updating the call site now or accept the error temporarily.)

- [ ] **Step 8: Commit**

```bash
git add packages/vscode-extension/src/preview.ts
git commit -m "feat(vscode): extend preview with diff state and postDiff"
```

---

### Task 4: Handle diff messages in `webview.ts`

**Files:**
- Modify: `packages/vscode-extension/src/webview.ts`

- [ ] **Step 1: Add `MessageToWebview` diff variants**

In `webview.ts`, extend the local `MessageToWebview` type:

```ts
type MessageToWebview =
  | {
      type: "render";
      dot: string;
      focusNodeId?: string;
      descriptions?: Record<string, string>;
    }
  | { type: "error"; message: string }
  | { type: "focus"; nodeId: string }
  | { type: "clearFocus" }
  | {
      type: "diff";
      report: {
        addedNodes: string[];
        removedNodes: string[];
        addedEdges: string[];
        removedEdges: string[];
        addedFeedback: string[];
        removedFeedback: string[];
      };
    }
  | { type: "clearDiff" };
```

- [ ] **Step 2: Add diff panel state and helpers**

After the existing `let lastFocusedNodeId: string | undefined;` line, add:

```ts
const diffPanel = document.getElementById("diff-panel") as HTMLDivElement;
type StoredDiff = { addedNodes: string[]; removedNodes: string[]; addedEdges: string[]; removedEdges: string[]; addedFeedback: string[]; removedFeedback: string[] };
let currentDiff: StoredDiff | null = null;

function renderDiffPanel(report: StoredDiff): void {
  const lines: string[] = [];
  for (const n of report.addedNodes) lines.push(`+ node  ${n}`);
  for (const n of report.removedNodes) lines.push(`- node  ${n}`);
  for (const e of report.addedEdges) lines.push(`+ edge  ${e}`);
  for (const e of report.removedEdges) lines.push(`- edge  ${e}`);
  for (const f of report.addedFeedback) lines.push(`+ feedback  ${f}`);
  for (const f of report.removedFeedback) lines.push(`- feedback  ${f}`);
  if (lines.length === 0) {
    diffPanel.innerHTML = `<span class="diff-none">No structural differences</span>`;
  } else {
    diffPanel.innerHTML = lines
      .map((l) => `<div class="${l.startsWith("+") ? "diff-add" : "diff-remove"}">${escapeHtml(l)}</div>`)
      .join("");
  }
  diffPanel.style.display = "block";
}

function clearDiffPanel(): void {
  currentDiff = null;
  diffPanel.innerHTML = "";
  diffPanel.style.display = "none";
}
```

- [ ] **Step 3: Handle diff and clearDiff messages**

In the `window.addEventListener("message", ...)` handler, add before the `if (msg.type !== "render") return;` line:

```ts
  if (msg.type === "diff") {
    currentDiff = msg.report;
    renderDiffPanel(msg.report);
    return;
  }
  if (msg.type === "clearDiff") {
    clearDiffPanel();
    return;
  }
```

- [ ] **Step 4: Re-apply diff after each render**

At the very end of the `render` branch (after the `try/catch` block that renders the SVG), add:

```ts
    if (currentDiff) renderDiffPanel(currentDiff);
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/vscode-extension typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/src/webview.ts
git commit -m "feat(vscode): render diff panel in webview"
```

---

### Task 5: Create `diff.ts` — `pfdsl.diff` and `pfdsl.clearDiff` commands

**Files:**
- Create: `packages/vscode-extension/src/diff.ts`

- [ ] **Step 1: Create `packages/vscode-extension/src/diff.ts`**

```ts
import { analyze, diffGraphs, type DiffReport } from "@pfdsl/core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import * as vscode from "vscode";
import { analyzeDocument } from "./analyze.js";
import { requireActivePfdslEditor } from "./utils.js";

export function registerDiff(
  context: vscode.ExtensionContext,
  postDiff: (report: DiffReport | null) => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("pfdsl.diff", async () => {
      const editor = requireActivePfdslEditor();
      if (!editor) return;

      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(git-commit) Compare with git ref...", id: "git" as const },
          { label: "$(file) Compare with file...", id: "file" as const },
        ],
        { title: "PFDSL: Diff" },
      );
      if (!pick) return;

      let otherContent: string;

      if (pick.id === "git") {
        const ref = await vscode.window.showInputBox({
          title: "Compare with git ref",
          value: "HEAD",
          prompt: "Commit hash, branch, tag, or HEAD~N",
        });
        if (ref === undefined) return;

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(
          editor.document.uri,
        );
        if (!workspaceFolder) {
          vscode.window.showErrorMessage("PFDSL: No workspace folder found.");
          return;
        }
        const workspaceRoot = workspaceFolder.uri.fsPath;
        const relPath = relative(workspaceRoot, editor.document.uri.fsPath);

        try {
          otherContent = execSync(`git show ${ref}:${relPath}`, {
            cwd: workspaceRoot,
            encoding: "utf-8",
          });
        } catch {
          vscode.window.showErrorMessage(
            `PFDSL: File not found at ref "${ref}" (${relPath})`,
          );
          return;
        }
      } else {
        const uris = await vscode.window.showOpenDialog({
          filters: { "PFDSL files": ["pfdsl"] },
          canSelectMany: false,
          title: "Compare with...",
        });
        if (!uris || uris.length === 0) return;
        try {
          otherContent = readFileSync(uris[0].fsPath, "utf-8");
        } catch (e) {
          vscode.window.showErrorMessage(
            `PFDSL: Failed to read file: ${(e as Error).message}`,
          );
          return;
        }
      }

      const otherResult = analyze(otherContent);
      const fatal = otherResult.diagnostics.find(
        (d) => d.severity === "error",
      );
      if (fatal) {
        vscode.window.showErrorMessage(
          `PFDSL: Parse error in comparison target: ${fatal.message}`,
        );
        return;
      }

      const currentGraph = analyzeDocument(editor.document).graph;
      const report = diffGraphs(currentGraph, otherResult.graph);

      await vscode.commands.executeCommand("pfdsl.preview");
      postDiff(report);
    }),

    vscode.commands.registerCommand("pfdsl.clearDiff", () => {
      postDiff(null);
    }),
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/vscode-extension typecheck
```

Expected: no errors (extension.ts still imports old signature — fix in Task 6).

- [ ] **Step 3: Commit**

```bash
git add packages/vscode-extension/src/diff.ts
git commit -m "feat(vscode): add pfdsl.diff and pfdsl.clearDiff commands"
```

---

### Task 6: Wire up — `extension.ts` and `package.json`

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/package.json`

- [ ] **Step 1: Update `extension.ts`**

Replace the contents of `packages/vscode-extension/src/extension.ts`:

```ts
import type * as vscode from "vscode";
import { clearAnalyzeCache } from "./analyze.js";
import { registerDiagnostics } from "./diagnostics.js";
import { registerExport } from "./export.js";
import { registerFormatter } from "./format.js";
import { registerHover } from "./hover.js";
import { registerPreview } from "./preview.js";
import { registerDiff } from "./diff.js";

export function activate(context: vscode.ExtensionContext): void {
  registerDiagnostics(context);
  registerFormatter(context);
  registerHover(context);
  const { postDiff } = registerPreview(context);
  registerExport(context);
  registerDiff(context, postDiff);
}

export function deactivate(): void {
  clearAnalyzeCache();
}
```

- [ ] **Step 2: Add commands to `package.json`**

In `packages/vscode-extension/package.json`, inside the `"commands"` array, append:

```json
{
  "command": "pfdsl.diff",
  "title": "PFDSL: Diff..."
},
{
  "command": "pfdsl.clearDiff",
  "title": "PFDSL: Clear Diff"
}
```

- [ ] **Step 3: Typecheck everything**

```bash
cd /Users/m5/works/pfdsl && pnpm typecheck
```

Expected: no errors across all packages.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/m5/works/pfdsl && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Build extension**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/vscode-extension build
```

Expected: build succeeds without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/src/extension.ts packages/vscode-extension/package.json
git commit -m "feat(vscode): wire up diff commands in extension"
```

---

### Task 7: Manual smoke test

- [ ] Open a `.pfdsl` file in VSCode (Dev Extension host via `F5` or `pnpm --filter @pfdsl/vscode-extension watch`)
- [ ] Run `PFDSL: Open Preview to the Side` — confirm preview renders
- [ ] Run `PFDSL: Diff...` → select `Compare with git ref...` → press Enter (HEAD) — confirm diff panel appears at bottom of preview with `+ node` / `- node` / `+ edge` / `- edge` lines (or "No structural differences")
- [ ] Edit the file — confirm SVG updates and diff panel stays visible with same report
- [ ] Run `PFDSL: Clear Diff` — confirm diff panel disappears
- [ ] Run `PFDSL: Diff...` → select `Compare with file...` → pick another `.pfdsl` file — confirm diff panel shows correct differences
- [ ] Run `PFDSL: Diff...` with an invalid git ref — confirm error notification appears and no crash
