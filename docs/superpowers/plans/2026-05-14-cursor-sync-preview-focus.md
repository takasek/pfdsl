# Cursor-Sync Preview Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the cursor is on a node identifier in the `.pfdsl` editor, the preview panel automatically pans to that node and highlights it with a glow effect.

**Architecture:** Add a `{ type: "focus"; nodeId: string }` message from extension → webview, triggered by `onDidChangeTextEditorSelection`. The webview adds a `pfdsl-focused` CSS class to the matching `g.node` SVG element and pans to center it. A `lastFocusedNodeId` module variable persists the highlight across re-renders.

**Tech Stack:** TypeScript, VSCode Extension API, SVG DOM manipulation, CSS filter/drop-shadow

---

## File Map

- Modify: `packages/vscode-extension/src/preview.ts` — add selection listener, extend message type
- Modify: `packages/vscode-extension/src/webview.ts` — add focus message handling, highlight CSS, lastFocusedNodeId state

---

### Task 1: Extend message types and add selection listener in preview.ts

**Files:**
- Modify: `packages/vscode-extension/src/preview.ts`

- [ ] **Step 1: Add `focus` to the webview message union type**

In `preview.ts`, the `MessageFromWebview` type is defined at the top. There is no `MessageToWebview` type in this file currently (messages are sent inline). Add a `MessageToWebview` type above `MessageFromWebview` and use it as the type for `postMessage` calls.

Find this block (around line 60):

```ts
type MessageFromWebview =
	| { type: "ready" }
	| { type: "nodeClick"; nodeId: string };
```

Replace with:

```ts
type MessageToWebview =
	| { type: "render"; dot: string; focusNodeId?: string; descriptions?: Record<string, string> }
	| { type: "error"; message: string }
	| { type: "focus"; nodeId: string };

type MessageFromWebview =
	| { type: "ready" }
	| { type: "nodeClick"; nodeId: string };
```

- [ ] **Step 2: Run typecheck to verify types compile**

```bash
cd packages/vscode-extension && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Add `onDidChangeTextEditorSelection` subscription**

Inside `registerPreview`, after the `vscode.workspace.onDidChangeTextDocument` subscription (around line 250), add:

```ts
vscode.window.onDidChangeTextEditorSelection((e) => {
    if (!current || e.textEditor.document !== current.doc) return;
    const result = analyzeDocument(current.doc);
    const nodeId = nodeIdAtCursor(result, e.selections[0].active);
    if (nodeId) {
        current.panel.webview.postMessage({ type: "focus", nodeId } satisfies MessageToWebview);
    }
}),
```

This goes inside `context.subscriptions.push(...)` as a new entry (comma-separated from the existing entries).

- [ ] **Step 4: Run typecheck**

```bash
cd packages/vscode-extension && pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/vscode-extension/src/preview.ts
git commit -m "feat(vscode-extension): send focus message on cursor selection change"
```

---

### Task 2: Add highlight CSS to buildHtml

**Files:**
- Modify: `packages/vscode-extension/src/preview.ts`

- [ ] **Step 1: Add `.pfdsl-focused` CSS rule to the `<style>` block in `buildHtml`**

In `buildHtml`, find the existing `<style>` block. It ends with:

```css
  #tooltip { ... }
```

Add this rule immediately after the `#tooltip` rule, before the closing `</style>`:

```css
  g.node.pfdsl-focused ellipse,
  g.node.pfdsl-focused polygon,
  g.node.pfdsl-focused path { filter: drop-shadow(0 0 5px currentColor); stroke-width: 2.5; }
```

- [ ] **Step 2: Run typecheck**

```bash
cd packages/vscode-extension && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/vscode-extension/src/preview.ts
git commit -m "feat(vscode-extension): add pfdsl-focused highlight CSS to preview webview"
```

---

### Task 3: Update focusNode() in webview.ts to apply highlight class

**Files:**
- Modify: `packages/vscode-extension/src/webview.ts`

- [ ] **Step 1: Add `lastFocusedNodeId` module state**

In `webview.ts`, after the `let descriptions: Record<string, string> = {};` line (around line 44), add:

```ts
let lastFocusedNodeId: string | undefined;
```

- [ ] **Step 2: Extend focusNode() to apply the highlight class**

Find the existing `focusNode` function (around line 98):

```ts
function focusNode(nodeId: string) {
	const nodes = inner.querySelectorAll("g.node");
	for (const node of nodes) {
		const title = node.querySelector("title");
		if (title?.textContent === nodeId) {
			const nodeRect = node.getBoundingClientRect();
			const rootRect = root.getBoundingClientRect();
			panX +=
				root.clientWidth / 2 -
				(nodeRect.left + nodeRect.width / 2 - rootRect.left);
			panY +=
				root.clientHeight / 2 -
				(nodeRect.top + nodeRect.height / 2 - rootRect.top);
			applyTransform();
			return;
		}
	}
}
```

Replace with:

```ts
function focusNode(nodeId: string) {
	const nodes = inner.querySelectorAll("g.node");
	for (const node of nodes) {
		node.classList.remove("pfdsl-focused");
	}
	lastFocusedNodeId = nodeId;
	for (const node of nodes) {
		const title = node.querySelector("title");
		if (title?.textContent === nodeId) {
			node.classList.add("pfdsl-focused");
			const nodeRect = node.getBoundingClientRect();
			const rootRect = root.getBoundingClientRect();
			panX +=
				root.clientWidth / 2 -
				(nodeRect.left + nodeRect.width / 2 - rootRect.left);
			panY +=
				root.clientHeight / 2 -
				(nodeRect.top + nodeRect.height / 2 - rootRect.top);
			applyTransform();
			return;
		}
	}
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd packages/vscode-extension && pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/vscode-extension/src/webview.ts
git commit -m "feat(vscode-extension): highlight focused node in preview webview"
```

---

### Task 4: Re-apply highlight after re-render and handle first-render case

**Files:**
- Modify: `packages/vscode-extension/src/webview.ts`

The problem: when the user edits text, `sendUpdate` fires, SVG is replaced → all classes are gone. `lastFocusedNodeId` must be re-applied.

Also, on first render, the initial `focusNodeId` from the `render` message must set `lastFocusedNodeId`.

- [ ] **Step 1: Update the render message handler to re-apply highlight**

Find the `window.addEventListener("message", ...)` handler. Inside, find the `render` branch. The current code (around line 200):

```ts
if (!hasPositioned) {
    hasPositioned = true;
    const focusNodeId = msg.focusNodeId;
    log("scheduling center, focusNodeId:", focusNodeId);
    requestAnimationFrame(() => {
        log("rAF fired, inner.offsetWidth:", inner.offsetWidth);
        centerGraph();
        if (focusNodeId) focusNode(focusNodeId);
    });
}
```

Replace with:

```ts
if (!hasPositioned) {
    hasPositioned = true;
    const focusNodeId = msg.focusNodeId;
    log("scheduling center, focusNodeId:", focusNodeId);
    requestAnimationFrame(() => {
        log("rAF fired, inner.offsetWidth:", inner.offsetWidth);
        centerGraph();
        if (focusNodeId) focusNode(focusNodeId);
    });
} else if (lastFocusedNodeId) {
    requestAnimationFrame(() => {
        if (lastFocusedNodeId) focusNode(lastFocusedNodeId);
    });
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd packages/vscode-extension && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/vscode-extension/src/webview.ts
git commit -m "feat(vscode-extension): re-apply highlight after SVG re-render"
```

---

### Task 5: Handle `focus` message in webview message handler

**Files:**
- Modify: `packages/vscode-extension/src/webview.ts`

- [ ] **Step 1: Add `focus` to MessageToWebview type in webview.ts**

In `webview.ts`, find the `MessageToWebview` type (around line 1):

```ts
type MessageToWebview =
	| {
			type: "render";
			dot: string;
			focusNodeId?: string;
			descriptions?: Record<string, string>;
	  }
	| { type: "error"; message: string };
```

Replace with:

```ts
type MessageToWebview =
	| {
			type: "render";
			dot: string;
			focusNodeId?: string;
			descriptions?: Record<string, string>;
	  }
	| { type: "error"; message: string }
	| { type: "focus"; nodeId: string };
```

- [ ] **Step 2: Add `focus` case to the message handler**

In `window.addEventListener("message", ...)`, after `if (msg.type !== "render") return;`, add handling for `focus` before that guard. Replace:

```ts
	if (msg.type === "error") {
		inner.innerHTML = `<div class="err">${escapeHtml(msg.message)}</div>`;
		return;
	}
	if (msg.type !== "render") return;
```

With:

```ts
	if (msg.type === "error") {
		inner.innerHTML = `<div class="err">${escapeHtml(msg.message)}</div>`;
		return;
	}
	if (msg.type === "focus") {
		focusNode(msg.nodeId);
		return;
	}
	if (msg.type !== "render") return;
```

- [ ] **Step 3: Run typecheck**

```bash
cd packages/vscode-extension && pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Build extension**

```bash
cd packages/vscode-extension && pnpm build
```

Expected: `dist/extension.cjs` and `dist/webview.js` generated, no errors

- [ ] **Step 5: Manual test**

1. Open VS Code with this extension loaded (run `pnpm build` first, then `F5` to launch Extension Development Host)
2. Open any `.pfdsl` file
3. Run `PFDSL: Open Preview to the Side`
4. Place cursor on a node identifier in the editor
5. Expected: preview pans to that node and it glows
6. Move cursor to a different node
7. Expected: previous glow disappears, new node glows and is centered
8. Move cursor to whitespace/arrow
9. Expected: last highlighted node stays highlighted, no pan
10. Edit the file text
11. Expected: after re-render, the last focused node is still highlighted

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/src/webview.ts
git commit -m "feat(vscode-extension): handle focus message to pan and highlight node"
```
