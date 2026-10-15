export const FOCUS_CUE_DURATION_MS = 1500;

const graphStyles =
	".pfdsl-preview { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--pfdsl-editor-background, #fff); color: var(--pfdsl-editor-foreground, #222); }\n.pfdsl-preview { display: flex; flex-direction: column; }\n#root-wrap { flex: 1; min-height: 0; position: relative; }\n#root { width: 100%; height: 100%; overflow: hidden; cursor: grab; position: relative; }\n#inner { position: absolute; top: 0; left: 0; }\n.err { padding: 12px; color: var(--pfdsl-errorForeground); white-space: pre-wrap; font-family: var(--pfdsl-editor-font-family); }\n#tooltip { position: fixed; background: var(--pfdsl-editorHoverWidget-background, #2d2d2d); color: var(--pfdsl-editorHoverWidget-foreground, #ccc); border: 1px solid var(--pfdsl-editorHoverWidget-border, #454545); padding: 4px 8px; border-radius: 3px; font-size: 12px; max-width: 360px; pointer-events: none; display: none; z-index: 100; word-break: break-word; }\n#tooltip .tt-table { border-collapse: collapse; }\n#tooltip .tt-key { text-align: right; color: var(--pfdsl-descriptionForeground, #888); font-style: italic; font-size: 0.9em; white-space: nowrap; width: 1%; padding-right: 6px; vertical-align: top; }\n#tooltip .tt-val { text-align: left; vertical-align: top; }\n#tooltip .tt-body { padding-bottom: 4px; }\n#tooltip .tt-hint { color: var(--pfdsl-descriptionForeground, #888); font-style: italic; font-size: 0.9em; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--pfdsl-editorHoverWidget-border, #454545); }\n#diff-panel { display: none; flex-shrink: 0; max-height: 200px; overflow-y: auto; padding: 6px 12px; font-family: var(--pfdsl-editor-font-family); font-size: var(--pfdsl-editor-font-size, 12px); border-top: 1px solid var(--pfdsl-panel-border, #333); background: var(--pfdsl-editor-background); }\n.diff-add { color: var(--pfdsl-gitDecoration-addedResourceForeground, #4caf50); white-space: pre; }\n.diff-remove { color: var(--pfdsl-gitDecoration-deletedResourceForeground, #f44336); white-space: pre; }\n.diff-change { color: var(--pfdsl-gitDecoration-modifiedResourceForeground, #e2c08d); white-space: pre; }\n.diff-none { color: var(--pfdsl-descriptionForeground, #888); font-style: italic; }\n#minimap { position: absolute; bottom: 12px; right: 12px; max-width: 160px; max-height: 120px; background: var(--pfdsl-editor-background); border: 1px solid var(--pfdsl-panel-border, #555); border-radius: 4px; overflow: hidden; z-index: 50; opacity: 0.85; display: none; cursor: crosshair; }\n#minimap-svg { position: absolute; top: 0; left: 0; pointer-events: none; }\n#minimap-vp { position: absolute; border: 1.5px solid var(--pfdsl-focusBorder, #007fd4); background: rgba(0,127,212,0.12); pointer-events: none; }";
const previewControlsStyles = `
#tooltip { pointer-events: auto; max-width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow: auto; word-break: normal; overflow-wrap: anywhere; }
#tooltip .tt-val[data-field="status"] { white-space: nowrap; }
.pfdsl-focus-ring { position: absolute; pointer-events: none; outline: 2px solid var(--pfdsl-focusBorder, #007fd4); animation: pfdsl-cue ${FOCUS_CUE_DURATION_MS}ms ease-out; }
@keyframes pfdsl-cue { from { opacity: 1; } to { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .pfdsl-focus-ring { animation: none; } }
#inner g.node:focus-visible { outline: 2px solid var(--pfdsl-focusBorder, #007fd4); }
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
  <button id="node-actions-toggle" type="button" disabled aria-controls="node-actions" aria-expanded="false">Connections</button>
  <button id="preview-help-toggle" type="button" aria-expanded="false" aria-controls="preview-help">Help</button>
</div>
<div id="preview-help" hidden>Wheel: zoom at the pointer. Drag: pan. Minimap: click or drag to move. Double-click a node: go to source. Double-click the background: 100%. Right-click a node or focus it and press Enter: Connections. Hover a node: read its information. Escape: close. <span data-related-files-help>Ctrl/⌘+Click: open a node's location or subflow.</span></div>
<div id="root-wrap"><div id="root"><div id="inner"></div></div><div id="preview-error" class="err" role="alert" tabindex="0" hidden></div><div id="minimap"><div id="minimap-svg"></div><div id="minimap-vp"></div></div></div>
<div id="tooltip" role="region" tabindex="0" aria-label="Node information"></div>
<section id="node-actions" aria-label="Connections" hidden>
  <div class="connections-heading"><strong id="node-actions-title"></strong><button id="create-definition" type="button">Create definition</button><button id="node-actions-close" type="button">Close</button></div>
  <div class="connections-grid"></div>
  <div class="connection-menu" role="group" aria-label="Connection actions" hidden></div>
  <p id="node-actions-error" role="alert"></p>
</section>
<div id="diff-panel"></div>`;

const connectionsStyles = `
#node-actions { flex-shrink: 0; padding: 8px; border-top: 1px solid var(--pfdsl-panel-border, #555); font: 12px var(--pfdsl-editor-font-family, sans-serif); overflow: visible; display: flex; flex-direction: column; min-height: 0; max-height: 42%; position: relative; }
#node-actions[hidden] { display: none; }
.connections-heading { display: flex; gap: 6px; align-items: center; }
.connections-heading strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.connections-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(48px, 20%) minmax(0, 1fr); min-height: 0; }
.connections-side { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
.connections-list { overflow-y: auto; scrollbar-gutter: stable; min-height: 30px; max-height: 180px; flex: 1; }
.connection-row, .connections-input { display: grid; grid-template-columns: minmax(0, 1fr) 32px; gap: 0; align-items: center; }
[data-side="right"] .connection-row, [data-side="right"] .connections-input { grid-template-columns: 32px minmax(0, 1fr); }
.connections-input { overflow-y: auto; scrollbar-gutter: stable; flex-shrink: 0; }
.connections-center { align-self: center; text-align: center; overflow-wrap: anywhere; padding: 4px; }
#node-actions button, #node-actions input { color: inherit; background: var(--pfdsl-editor-background, #fff); font: inherit; margin: 4px; min-width: 0; box-sizing: border-box; overflow-wrap: anywhere; }
#node-actions input { width: calc(100% - 8px); padding: 4px; }
#node-actions [data-edge], #node-actions [data-create] { padding: 2px; min-height: 24px; border: 1px solid var(--pfdsl-panel-border, #777); }
.connection-candidates { position: absolute; bottom: 100%; left: 0; right: 0; max-height: min(220px, 35vh); overflow: auto; background: var(--pfdsl-editor-background, #fff); border: 1px solid var(--pfdsl-panel-border, #777); z-index: 110; box-shadow: 0 2px 8px #0003; }
#node-actions .connection-candidates button { display: block; text-align: left; width: calc(100% - 8px); }
#node-actions .connection-candidates [aria-selected="true"] { outline: 2px solid var(--pfdsl-focusBorder, #007fd4); outline-offset: -2px; }
.connection-reason { font-size: 0.9em; overflow-wrap: anywhere; max-height: 3em; overflow: auto; }
.connection-menu { padding: 4px; border: 1px solid var(--pfdsl-panel-border, #777); }
#node-actions button:focus-visible, #node-actions input:focus-visible { outline: 2px solid var(--pfdsl-focusBorder, #007fd4); outline-offset: 1px; }
`;
export const previewStyles =
	graphStyles + previewControlsStyles + connectionsStyles;
