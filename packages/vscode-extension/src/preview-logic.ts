import { previewMarkup, previewStyles } from "@pfdsl/editor";

export type { CursorPosition } from "@pfdsl/editor";
export {
	allIdsOfDocument,
	blockingDiagnosticMessage,
	idsOfStatement,
	nodeIdAtCursor,
	positionOfNodeId,
} from "@pfdsl/editor";

export function buildHtml(
	scriptUri: string,
	cspSource: string,
	isDebug: boolean,
): string {
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src ${cspSource};" />
<style>${previewStyles} .pfdsl-preview { --pfdsl-editor-background: var(--vscode-editor-background); --pfdsl-editor-foreground: var(--vscode-editor-foreground); --pfdsl-errorForeground: var(--vscode-errorForeground); --pfdsl-editor-font-family: var(--vscode-editor-font-family); --pfdsl-editorHoverWidget-background: var(--vscode-editorHoverWidget-background); --pfdsl-editorHoverWidget-foreground: var(--vscode-editorHoverWidget-foreground); --pfdsl-editorHoverWidget-border: var(--vscode-editorHoverWidget-border); --pfdsl-descriptionForeground: var(--vscode-descriptionForeground); --pfdsl-editor-font-size: var(--vscode-editor-font-size); --pfdsl-panel-border: var(--vscode-panel-border); --pfdsl-gitDecoration-addedResourceForeground: var(--vscode-gitDecoration-addedResourceForeground); --pfdsl-gitDecoration-deletedResourceForeground: var(--vscode-gitDecoration-deletedResourceForeground); --pfdsl-gitDecoration-modifiedResourceForeground: var(--vscode-gitDecoration-modifiedResourceForeground); --pfdsl-focusBorder: var(--vscode-focusBorder); } html, body {width:100%;height:100%;margin:0;}</style>
<script>window.__PFDSL_DEBUG__ = ${isDebug};</script></head>
<body class="pfdsl-preview">${previewMarkup}<script type="module" src="${scriptUri}"></script></body></html>`;
}
