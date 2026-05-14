# Design: Cursor-Sync Preview Focus

## Overview

When the cursor is on a node identifier in the `.pfdsl` editor, the preview panel automatically pans to center that node and highlights it with a glow effect. Moving the cursor off a node leaves the last highlighted node highlighted (no reset).

## Architecture

Message flow:

```
Editor selection change
  → onDidChangeTextEditorSelection
  → nodeIdAtCursor()
  → if nodeId found: postMessage({ type: "focus", nodeId })
  → webview: pan + highlight
```

The `focus` message is separate from `render`. Cursor movement does not trigger re-rendering the DOT graph.

## Changes

### preview.ts

Add `{ type: "focus"; nodeId: string }` to the webview message types.

Add a `onDidChangeTextEditorSelection` subscription inside `registerPreview`:
- Skip if no active preview panel or if the changed editor's document is not the preview's document.
- Compute `nodeIdAtCursor(analyzeDocument(current.doc), e.selections[0].active)`.
- If a nodeId is found, `postMessage({ type: "focus", nodeId })`.

### webview.ts

**Message type:** Add `{ type: "focus"; nodeId: string }` to `MessageToWebview` union.

**State:** Add module-level `let lastFocusedNodeId: string | undefined`.

**`focusNode()` extension:** After panning, remove class `pfdsl-focused` from all `g.node` elements, then add it to the matching node. Update `lastFocusedNodeId`.

**Re-apply after render:** At the end of the `render` message handler (after SVG is written to DOM), if `lastFocusedNodeId` is set, call `focusNode(lastFocusedNodeId)` — but only after `hasPositioned` is true (i.e., not on the very first render, which already uses `pendingFocusNodeId` via `requestAnimationFrame`). On first render, set `lastFocusedNodeId = focusNodeId` inside the `requestAnimationFrame` callback after calling `focusNode`.

**CSS (in `buildHtml`):** Add to the `<style>` block:

```css
g.node.pfdsl-focused ellipse,
g.node.pfdsl-focused polygon,
g.node.pfdsl-focused path {
    filter: drop-shadow(0 0 4px currentColor);
    stroke-width: 2.5;
}
```

**`focus` message handler:** In the `window.addEventListener("message", ...)` handler, add a case for `msg.type === "focus"` that calls `focusNode(msg.nodeId)`.

## Edge Cases

- Cursor on non-node token (whitespace, arrow, comment): no message sent, last highlight maintained.
- Preview panel not open: listener fires but `current` is null, no-op.
- Document switches (e.g., user opens a different file): `e.textEditor.document !== current.doc` guard filters it out.
- SVG re-render (text edit): `lastFocusedNodeId` persists across renders and is re-applied after new SVG is injected.

## Out of Scope

- Debouncing (not needed at normal cursor-movement frequency; add later if jank observed).
- Highlighting edges (only nodes are targetable).
