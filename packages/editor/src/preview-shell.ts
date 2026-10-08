const graphStyles =
	".pfdsl-preview { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--pfdsl-editor-background, #fff); color: var(--pfdsl-editor-foreground, #222); }\n.pfdsl-preview { display: flex; flex-direction: column; }\n#root-wrap { flex: 1; min-height: 0; position: relative; }\n#root { width: 100%; height: 100%; overflow: hidden; cursor: grab; position: relative; }\n#inner { position: absolute; top: 0; left: 0; }\n.err { padding: 12px; color: var(--pfdsl-errorForeground); white-space: pre-wrap; font-family: var(--pfdsl-editor-font-family); }\n#tooltip { position: fixed; background: var(--pfdsl-editorHoverWidget-background, #2d2d2d); color: var(--pfdsl-editorHoverWidget-foreground, #ccc); border: 1px solid var(--pfdsl-editorHoverWidget-border, #454545); padding: 4px 8px; border-radius: 3px; font-size: 12px; max-width: 360px; pointer-events: none; display: none; z-index: 100; word-break: break-word; }\n#tooltip .tt-table { border-collapse: collapse; }\n#tooltip .tt-key { text-align: right; color: var(--pfdsl-descriptionForeground, #888); font-style: italic; font-size: 0.9em; white-space: nowrap; width: 1%; padding-right: 6px; vertical-align: top; }\n#tooltip .tt-val { text-align: left; vertical-align: top; }\n#tooltip .tt-body { padding-bottom: 4px; }\n#tooltip .tt-hint { color: var(--pfdsl-descriptionForeground, #888); font-style: italic; font-size: 0.9em; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--pfdsl-editorHoverWidget-border, #454545); }\n#diff-panel { display: none; flex-shrink: 0; max-height: 200px; overflow-y: auto; padding: 6px 12px; font-family: var(--pfdsl-editor-font-family); font-size: var(--pfdsl-editor-font-size, 12px); border-top: 1px solid var(--pfdsl-panel-border, #333); background: var(--pfdsl-editor-background); }\n.diff-add { color: var(--pfdsl-gitDecoration-addedResourceForeground, #4caf50); white-space: pre; }\n.diff-remove { color: var(--pfdsl-gitDecoration-deletedResourceForeground, #f44336); white-space: pre; }\n.diff-change { color: var(--pfdsl-gitDecoration-modifiedResourceForeground, #e2c08d); white-space: pre; }\n.diff-none { color: var(--pfdsl-descriptionForeground, #888); font-style: italic; }\n#minimap { position: absolute; bottom: 12px; right: 12px; max-width: 160px; max-height: 120px; background: var(--pfdsl-editor-background); border: 1px solid var(--pfdsl-panel-border, #555); border-radius: 4px; overflow: hidden; z-index: 50; opacity: 0.85; display: none; cursor: crosshair; }\n#minimap-svg { position: absolute; top: 0; left: 0; pointer-events: none; }\n#minimap-vp { position: absolute; border: 1.5px solid var(--pfdsl-focusBorder, #007fd4); background: rgba(0,127,212,0.12); pointer-events: none; }";
const previewControlsStyles = `
#tooltip { pointer-events: auto; max-width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow: auto; word-break: normal; overflow-wrap: anywhere; }
#tooltip .tt-val[data-field="status"] { white-space: nowrap; }
.tt-graph { max-width: 340px; max-height: 230px; overflow: auto; margin-top: 6px; }
.tt-graph svg { display: block; }
.tt-graph g.node { cursor: pointer; }
.pfdsl-focus-ring { position: absolute; pointer-events: none; outline: 2px solid var(--pfdsl-focusBorder, #007fd4); animation: pfdsl-cue 1.5s ease-out; }
@keyframes pfdsl-cue { from { opacity: 1; } to { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .pfdsl-focus-ring { animation: none; } }
#node-actions { flex-shrink: 0; padding: 8px; max-height: 40%; overflow: auto; font: 12px var(--pfdsl-editor-font-family, sans-serif); border-top: 1px solid var(--pfdsl-panel-border, #555); }
#node-actions button, #node-actions input, #node-actions select { color: inherit; background: var(--pfdsl-editor-background, #fff); font: inherit; margin: 4px; }
#node-actions label { display: block; }
#inner g.node:focus-visible, .tt-graph g.node:focus-visible { outline: 2px solid var(--pfdsl-focusBorder, #007fd4); }
#preview-toolbar { flex-shrink: 0; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 8px; border-bottom: 1px solid var(--pfdsl-panel-border, #555); font: 12px var(--pfdsl-editor-font-family, sans-serif); }
#preview-toolbar button { color: inherit; background: transparent; border: 1px solid var(--pfdsl-panel-border, #555); border-radius: 3px; padding: 2px 6px; cursor: pointer; }
#preview-toolbar button:disabled { opacity: 0.5; cursor: default; }
#preview-toolbar button:focus-visible { outline: 2px solid var(--pfdsl-focusBorder, #007fd4); }
#zoom-level { min-width: 4em; text-align: center; }
#preview-help { padding: 6px 12px; flex-shrink: 0; max-height: 25%; overflow: auto; font: 12px var(--pfdsl-editor-font-family, sans-serif); }
#preview-error { position: absolute; inset: 0; margin: 0; overflow: auto; overflow-wrap: anywhere; font-size: 13px; cursor: text; }
`;
export const previewMarkup = `
<div id="preview-toolbar" role="group" aria-label="Diagram view">
  <button id="zoom-out" type="button" aria-label="Zoom out" disabled>−</button>
  <output id="zoom-level" aria-label="Zoom level">100%</output>
  <button id="zoom-in" type="button" aria-label="Zoom in" disabled>+</button>
  <button id="fit-graph" type="button" disabled>Fit</button>
  <button id="actual-size" type="button" disabled>100%</button>
  <button id="node-actions-toggle" type="button" disabled aria-controls="node-actions" aria-expanded="false">Node actions</button>
  <button id="preview-help-toggle" type="button" aria-expanded="false" aria-controls="preview-help">Help</button>
</div>
<div id="preview-help" hidden>Wheel: zoom at the pointer. Drag: pan. Minimap: click or drag to move. Double-click a node: go to source. Double-click the background: 100%. Right-click a node or focus it and press Enter: Node actions. Hover a node: view and click its direct neighbors. Escape: close. <span data-related-files-help>Ctrl/⌘+Click: open a node's location or subflow.</span></div>
<div id="root-wrap"><div id="root"><div id="inner"></div></div><div id="preview-error" class="err" role="alert" tabindex="0" hidden></div><div id="minimap"><div id="minimap-svg"></div><div id="minimap-vp"></div></div></div>
<div id="tooltip" role="region" aria-label="Node neighborhood"></div>
<section id="node-actions" aria-label="Node actions" hidden>
  <strong id="node-actions-title"></strong><button id="node-actions-close" type="button">Close</button>
  <button id="create-definition" type="button">Create definition</button>
  <form id="connector-form">
    <label>Connection (arrow direction)<select id="connector-kind"></select></label>
    <label>Existing node<select id="connector-existing"><option value="">New node ID…</option></select></label>
    <label>Target node ID<input id="connector-target" required autocomplete="off"></label>
    <button type="submit">Add connection</button>
  </form>
  <p id="node-actions-error" role="alert"></p>
</section>
<div id="diff-panel"></div>`;

export const previewStyles = graphStyles + previewControlsStyles;
