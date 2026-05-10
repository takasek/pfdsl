import { exportDot } from "@pfdsl/graphviz-exporter";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";

interface PreviewState {
	panel: vscode.WebviewPanel;
	doc: vscode.TextDocument;
	webviewReady: boolean;
}

type MessageFromWebview =
	| { type: "ready" }
	| { type: "nodeClick"; nodeId: string };

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

function buildHtml(scriptUri: vscode.Uri, cspSource: string): string {
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
</style>
</head>
<body>
<div id="root"><div id="inner"></div></div>
<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function jumpToNode(doc: vscode.TextDocument, nodeId: string): void {
	const text = doc.getText();
	const idx = text.indexOf(nodeId);
	if (idx === -1) return;
	const pos = doc.positionAt(idx);
	vscode.window.showTextDocument(doc, {
		selection: new vscode.Range(pos, pos.translate(0, nodeId.length)),
		preserveFocus: false,
	});
}

export function registerPreview(context: vscode.ExtensionContext): void {
	let current: PreviewState | null = null;

	function sendUpdate(state: PreviewState): void {
		if (!state.webviewReady) return;
		const { dot, error } = dotForDocument(state.doc);
		state.panel.title = `PFDSL Preview — ${state.doc.uri.path.split("/").pop() ?? ""}`;
		state.panel.webview.postMessage(
			error ? { type: "error", message: error } : { type: "render", dot },
		);
	}

	function createPanel(doc: vscode.TextDocument): PreviewState {
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
		panel.webview.html = buildHtml(webviewScriptUri, panel.webview.cspSource);

		const state: PreviewState = { panel, doc, webviewReady: false };

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
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== LANGUAGE_ID) {
				vscode.window.showInformationMessage("Open a .pfdsl file first.");
				return;
			}
			const doc = editor.document;

			if (current) {
				current.doc = doc;
				current.panel.reveal(vscode.ViewColumn.Beside, true);
				sendUpdate(current);
				return;
			}

			current = createPanel(doc);
		}),

		vscode.workspace.onDidChangeTextDocument((e) => {
			if (current && e.document === current.doc) {
				sendUpdate(current);
			}
		}),
	);
}
