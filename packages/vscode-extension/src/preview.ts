import type {
	AnalyzeResult,
	Frontmatter,
	IdNode,
	Statement,
} from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter";
import * as vscode from "vscode";
import { analyzeDocument } from "./analyze.js";
import { requireActivePfdslEditor } from "./utils.js";

interface PreviewState {
	panel: vscode.WebviewPanel;
	doc: vscode.TextDocument;
	webviewReady: boolean;
	pendingFocusNodeId?: string;
}

function idsOfStatement(stmt: Statement): IdNode[] {
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

function nodeIdAtCursor(
	result: AnalyzeResult,
	pos: vscode.Position,
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

type MessageToWebview =
	| {
			type: "render";
			dot: string;
			focusNodeId?: string;
			descriptions?: Record<string, string>;
	  }
	| { type: "error"; message: string }
	| { type: "focus"; nodeId: string }
	| { type: "clearFocus" };

type MessageFromWebview =
	| { type: "ready" }
	| { type: "nodeClick"; nodeId: string };

function buildDescriptions(fm: Frontmatter | null): Record<string, string> {
	const result: Record<string, string> = {};
	if (!fm) return result;
	for (const id of Object.keys(fm.artifact ?? {})) {
		const desc = fm.artifact?.[id]?.description;
		if (typeof desc === "string" && desc) result[id] = desc;
	}
	for (const id of Object.keys(fm.process ?? {})) {
		const desc = fm.process?.[id]?.description;
		if (typeof desc === "string" && desc) result[id] = desc;
	}
	return result;
}

function dotForDocument(doc: vscode.TextDocument): {
	dot?: string;
	error?: string;
} {
	const { graph, frontmatter, diagnostics } = analyzeDocument(doc);
	const fatal = diagnostics.find((d) => d.severity === "error");
	if (fatal) return { error: `${fatal.code}: ${fatal.message}` };
	try {
		return { dot: exportDot(graph, frontmatter) };
	} catch (e) {
		return { error: `Export failed: ${(e as Error).message}` };
	}
}

function buildHtml(
	scriptUri: vscode.Uri,
	cspSource: string,
	isDebug: boolean,
): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:;" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  #root { width: 100%; height: 100%; overflow: hidden; cursor: grab; position: relative; }
  #inner { position: absolute; top: 0; left: 0; }
  .err { padding: 12px; color: var(--vscode-errorForeground); white-space: pre-wrap; font-family: var(--vscode-editor-font-family); }
  #tooltip { position: fixed; background: var(--vscode-editorHoverWidget-background, #2d2d2d); color: var(--vscode-editorHoverWidget-foreground, #ccc); border: 1px solid var(--vscode-editorHoverWidget-border, #454545); padding: 4px 8px; border-radius: 3px; font-size: 12px; max-width: 320px; pointer-events: none; display: none; z-index: 100; white-space: pre-wrap; word-break: break-word; }
  g.node.pfdsl-focused ellipse,
  g.node.pfdsl-focused polygon,
  g.node.pfdsl-focused path { filter: drop-shadow(0 0 5px currentColor); stroke-width: 2.5; }
</style>
<script>window.__PFDSL_DEBUG__ = ${isDebug};</script>
</head>
<body>
<div id="root"><div id="inner"></div></div>
<div id="tooltip"></div>
<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function jumpToNode(doc: vscode.TextDocument, nodeId: string): void {
	const result = analyzeDocument(doc);
	let targetPos: vscode.Position | undefined;
	outer: for (const stmt of result.document.statements) {
		for (const id of idsOfStatement(stmt)) {
			if (id.value === nodeId) {
				targetPos = new vscode.Position(id.start.line - 1, id.start.column - 1);
				break outer;
			}
		}
	}
	if (!targetPos) return;
	const range = new vscode.Range(
		targetPos,
		targetPos.translate(0, nodeId.length),
	);
	const existingEditor = vscode.window.visibleTextEditors.find(
		(e) => e.document === doc,
	);
	if (existingEditor) {
		existingEditor.selection = new vscode.Selection(
			targetPos,
			targetPos.translate(0, nodeId.length),
		);
		existingEditor.revealRange(range);
		vscode.window.showTextDocument(doc, {
			viewColumn: existingEditor.viewColumn,
			preserveFocus: false,
		});
	} else {
		vscode.window.showTextDocument(doc, {
			selection: range,
			preserveFocus: false,
		});
	}
}

export function registerPreview(context: vscode.ExtensionContext): void {
	let current: PreviewState | null = null;

	function sendUpdate(state: PreviewState): void {
		if (!state.webviewReady) return;
		const { dot, error } = dotForDocument(state.doc);
		const focusNodeId = state.pendingFocusNodeId;
		delete state.pendingFocusNodeId;
		state.panel.title = `PFDSL Preview — ${state.doc.uri.path.split("/").pop() ?? ""}`;
		if (error) {
			state.panel.webview.postMessage({ type: "error", message: error });
		} else {
			const { frontmatter } = analyzeDocument(state.doc);
			const descriptions = buildDescriptions(frontmatter);
			state.panel.webview.postMessage({
				type: "render",
				dot,
				focusNodeId,
				descriptions,
			});
		}
	}

	function createPanel(
		doc: vscode.TextDocument,
		focusNodeId?: string,
	): PreviewState {
		const scriptUri = vscode.Uri.joinPath(
			context.extensionUri,
			"dist",
			"webview.js",
		);
		const panel = vscode.window.createWebviewPanel(
			"pfdslPreview",
			"PFDSL Preview",
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
			},
		);
		const webviewScriptUri = panel.webview.asWebviewUri(scriptUri);
		const isDebug = context.extensionMode === vscode.ExtensionMode.Development;
		panel.webview.html = buildHtml(
			webviewScriptUri,
			panel.webview.cspSource,
			isDebug,
		);

		const state: PreviewState = {
			panel,
			doc,
			webviewReady: false,
			...(focusNodeId ? { pendingFocusNodeId: focusNodeId } : {}),
		};

		panel.webview.onDidReceiveMessage((msg: MessageFromWebview) => {
			if (msg.type === "ready") {
				state.webviewReady = true;
				sendUpdate(state);
			} else if (msg.type === "nodeClick") {
				jumpToNode(state.doc, msg.nodeId);
			}
		});

		panel.onDidDispose(() => {
			current = null;
		});
		context.subscriptions.push(panel);
		return state;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.preview", async () => {
			const editor = requireActivePfdslEditor();
			if (!editor) return;
			const doc = editor.document;

			if (current) {
				current.doc = doc;
				current.panel.reveal(vscode.ViewColumn.Beside, true);
				sendUpdate(current);
				return;
			}

			const result = analyzeDocument(doc);
			const focusNodeId = nodeIdAtCursor(result, editor.selection.active);
			current = createPanel(doc, focusNodeId);
		}),

		vscode.workspace.onDidChangeTextDocument((e) => {
			if (current && e.document === current.doc) {
				sendUpdate(current);
			}
		}),

		vscode.window.onDidChangeTextEditorSelection((e) => {
			if (!current || e.textEditor.document !== current.doc) return;
			const sel = e.selections[0];
			if (!sel || sel.isEmpty) {
				current.panel.webview.postMessage({
					type: "clearFocus",
				} satisfies MessageToWebview);
				return;
			}
			const selectedText = e.textEditor.document.getText(sel);
			const result = analyzeDocument(current.doc);
			const allIds = new Set(
				result.document.statements
					.flatMap(idsOfStatement)
					.map((id) => id.value),
			);
			if (allIds.has(selectedText)) {
				current.panel.webview.postMessage({
					type: "focus",
					nodeId: selectedText,
				} satisfies MessageToWebview);
			} else {
				current.panel.webview.postMessage({
					type: "clearFocus",
				} satisfies MessageToWebview);
			}
		}),
	);
}
