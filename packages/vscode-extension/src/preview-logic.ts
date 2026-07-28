// The parts of the preview that do not need the vscode API: which ids a
// statement mentions, which id a cursor sits on, and the webview shell's HTML.
// Kept apart from preview.ts so they can be tested without an extension host,
// the same split the other *-logic modules use.
import type { AnalyzeResult, Diagnostic, IdNode, Statement } from "@pfdsl/core";

/** A cursor position in the editor's own 0-indexed coordinates. */
export interface CursorPosition {
	line: number;
	character: number;
}

export function idsOfStatement(stmt: Statement): IdNode[] {
	switch (stmt.type) {
		case "chain": {
			const ids: IdNode[] = [...stmt.head.ids];
			for (const seg of stmt.segments) {
				ids.push(seg.process);
				if (seg.output) ids.push(...seg.output.ids);
			}
			return ids;
		}
		case "input-edge":
			return [...stmt.artifact.ids, stmt.process];
		case "feedback-edge":
			return [...stmt.artifact.ids, stmt.process];
		case "output-edge":
			return [stmt.process, ...stmt.artifact.ids];
		case "node-decl":
			return [stmt.id];
	}
}

/** Every id the document mentions, in no particular order. */
export function allIdsOfDocument(result: AnalyzeResult): Set<string> {
	return new Set(
		result.document.statements.flatMap(idsOfStatement).map((id) => id.value),
	);
}

export function nodeIdAtCursor(
	result: AnalyzeResult,
	pos: CursorPosition,
): string | undefined {
	// vscode pos: 0-indexed; core positions: 1-indexed
	const line = pos.line + 1;
	const col = pos.character + 1;
	for (const stmt of result.document.statements) {
		for (const id of idsOfStatement(stmt)) {
			if (
				id.start.line === line &&
				col >= id.start.column &&
				col <= id.end.column
			) {
				return id.value;
			}
		}
	}
	return undefined;
}

export function buildHtml(
	scriptUri: string,
	cspSource: string,
	isDebug: boolean,
): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src ${cspSource};" />
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
body { display: flex; flex-direction: column; }
#root-wrap { flex: 1; min-height: 0; position: relative; }
#root { width: 100%; height: 100%; overflow: hidden; cursor: grab; position: relative; }
#inner { position: absolute; top: 0; left: 0; }
.err { padding: 12px; color: var(--vscode-errorForeground); white-space: pre-wrap; font-family: var(--vscode-editor-font-family); }
#tooltip { position: fixed; background: var(--vscode-editorHoverWidget-background, #2d2d2d); color: var(--vscode-editorHoverWidget-foreground, #ccc); border: 1px solid var(--vscode-editorHoverWidget-border, #454545); padding: 4px 8px; border-radius: 3px; font-size: 12px; max-width: 360px; pointer-events: none; display: none; z-index: 100; word-break: break-word; }
#tooltip .tt-table { border-collapse: collapse; }
#tooltip .tt-key { text-align: right; color: var(--vscode-descriptionForeground, #888); font-style: italic; font-size: 0.9em; white-space: nowrap; width: 1%; padding-right: 6px; vertical-align: top; }
#tooltip .tt-val { text-align: left; vertical-align: top; }
#tooltip .tt-body { padding-bottom: 4px; }
#tooltip .tt-hint { color: var(--vscode-descriptionForeground, #888); font-style: italic; font-size: 0.9em; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--vscode-editorHoverWidget-border, #454545); }
#diff-panel { display: none; flex-shrink: 0; max-height: 200px; overflow-y: auto; padding: 6px 12px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); border-top: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-editor-background); }
.diff-add { color: var(--vscode-gitDecoration-addedResourceForeground, #4caf50); white-space: pre; }
.diff-remove { color: var(--vscode-gitDecoration-deletedResourceForeground, #f44336); white-space: pre; }
.diff-change { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); white-space: pre; }
.diff-none { color: var(--vscode-descriptionForeground, #888); font-style: italic; }
#minimap { position: absolute; bottom: 12px; right: 12px; max-width: 160px; max-height: 120px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border, #555); border-radius: 4px; overflow: hidden; z-index: 50; opacity: 0.85; display: none; cursor: crosshair; }
#minimap-svg { position: absolute; top: 0; left: 0; pointer-events: none; }
#minimap-vp { position: absolute; border: 1.5px solid var(--vscode-focusBorder, #007fd4); background: rgba(0,127,212,0.12); pointer-events: none; }
</style>
<script>window.__PFDSL_DEBUG__ = ${isDebug};</script>
</head>
<body>
<div id="root-wrap"><div id="root"><div id="inner"></div></div><div id="minimap"><div id="minimap-svg"></div><div id="minimap-vp"></div></div></div>
<div id="tooltip"></div>
<div id="diff-panel"></div>
<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * What the preview shows in place of a graph, or undefined when it can render
 * one. An error-severity diagnostic means the document does not describe a
 * graph yet, so rendering the partial one would show something the file does
 * not say (#611).
 */
export function blockingDiagnosticMessage(
	diagnostics: readonly Diagnostic[],
): string | undefined {
	const fatal = diagnostics.find((d) => d.severity === "error");
	return fatal ? `${fatal.code}: ${fatal.message}` : undefined;
}

/**
 * Where an id first appears in the body, as a zero-origin editor position.
 * Statement order is document order, so the first hit is the topmost mention.
 */
export function positionOfNodeId(
	statements: readonly Statement[],
	nodeId: string,
): { line: number; column: number } | undefined {
	for (const stmt of statements) {
		for (const id of idsOfStatement(stmt)) {
			if (id.value === nodeId) {
				return { line: id.start.line - 1, column: id.start.column - 1 };
			}
		}
	}
	return undefined;
}
