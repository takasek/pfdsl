import type { AnalyzeResult, DiffReport, IdNode, Statement } from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter";
import * as vscode from "vscode";
import { analyzeDocument } from "./analyze.js";
import { findFrontmatterDefinition } from "./jump.js";
import { resolveLocationFsPath } from "./location-path.js";
import {
	buildDescriptions,
	buildLocations,
	buildSubflows,
} from "./location-utils.js";
import { requireActivePfdslEditor } from "./utils.js";

interface PreviewState {
	panel: vscode.WebviewPanel;
	doc: vscode.TextDocument;
	webviewReady: boolean;
	pendingFocusNodeId?: string;
	pendingDiff?: DiffReport | null; // null = clearDiff
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
			descriptions?: Record<string, Array<[string, string]>>;
			locations?: Record<string, string[]>;
			subflows?: Record<string, string>;
	  }
	| { type: "error"; message: string }
	| { type: "focus"; nodeId: string }
	| { type: "clearFocus" }
	| { type: "diff"; report: DiffReport }
	| { type: "clearDiff" };

type MessageFromWebview =
	| { type: "ready" }
	| { type: "nodeClick"; nodeId: string }
	| { type: "openUrl"; url: string }
	| { type: "openFile"; path: string }
	| { type: "openLocation"; nodeId: string };

async function expandDirectory(dirUri: vscode.Uri): Promise<string[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dirUri);
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const [name, type] of entries) {
		if (type === vscode.FileType.File) {
			files.push(vscode.Uri.joinPath(dirUri, name).fsPath);
		}
	}
	if (files.length === 0) {
		for (const [name, type] of entries) {
			if (type === vscode.FileType.Directory) {
				const sub = await expandDirectory(vscode.Uri.joinPath(dirUri, name));
				files.push(...sub);
			}
		}
	}
	return files;
}

type QuickPickLocationItem = vscode.QuickPickItem & {
	fsPath?: string;
	url?: string;
};

async function handleOpenLocation(
	docFsPath: string,
	locs: string[],
	fallbackViewColumn?: vscode.ViewColumn,
): Promise<void> {
	if (locs.length === 0) return;

	const items: QuickPickLocationItem[] = [];
	for (const loc of locs) {
		if (loc.includes("://")) {
			const url = new URL(loc);
			items.push({ label: url.hostname, description: loc, url: loc });
		} else {
			const resolvedPath = resolveLocationFsPath(docFsPath, loc);
			const resolvedUri = vscode.Uri.file(resolvedPath);
			let stat: vscode.FileStat | undefined;
			try {
				stat = await vscode.workspace.fs.stat(resolvedUri);
			} catch {
				// treat as file if stat fails
			}
			if (stat?.type === vscode.FileType.Directory) {
				const children = await expandDirectory(resolvedUri);
				if (children.length === 0) {
					vscode.window.showWarningMessage(`No files found in ${loc}`);
					return;
				}
				for (const child of children) {
					items.push({
						label: child.split("/").pop() ?? child,
						description: child,
						fsPath: child,
					});
				}
			} else {
				items.push({
					label: resolvedPath.split("/").pop() ?? resolvedPath,
					description: resolvedPath,
					fsPath: resolvedPath,
				});
			}
		}
	}

	if (items.length === 1) {
		const item = items[0]!;
		if (item.url) {
			await vscode.env.openExternal(vscode.Uri.parse(item.url));
		} else if (item.fsPath) {
			await openFileActivatingExisting(item.fsPath, fallbackViewColumn);
		}
		return;
	}

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: "Open location…",
	});
	if (!selected) return;
	if (selected.url) {
		await vscode.env.openExternal(vscode.Uri.parse(selected.url));
	} else if (selected.fsPath) {
		await openFileActivatingExisting(selected.fsPath, fallbackViewColumn);
	}
}

async function openFileActivatingExisting(
	fsPath: string,
	fallbackViewColumn?: vscode.ViewColumn,
): Promise<void> {
	const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
	const existing = vscode.window.visibleTextEditors.find(
		(e) => e.document.uri.toString() === doc.uri.toString(),
	);
	const vc = existing?.viewColumn ?? fallbackViewColumn;
	if (vc !== undefined) {
		await vscode.window.showTextDocument(doc, { viewColumn: vc });
	} else {
		await vscode.window.showTextDocument(doc, { preview: false });
	}
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

function jumpToNode(
	doc: vscode.TextDocument,
	nodeId: string,
	preferDefinition = false,
): void {
	let targetPos: vscode.Position | undefined;
	if (preferDefinition) {
		targetPos = findFrontmatterDefinition(doc, nodeId);
	}
	if (!targetPos) {
		const result = analyzeDocument(doc);
		outer: for (const stmt of result.document.statements) {
			for (const id of idsOfStatement(stmt)) {
				if (id.value === nodeId) {
					targetPos = new vscode.Position(
						id.start.line - 1,
						id.start.column - 1,
					);
					break outer;
				}
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
		const vc = existingEditor.viewColumn;
		if (vc !== undefined) {
			vscode.window.showTextDocument(doc, {
				viewColumn: vc,
				preserveFocus: false,
			});
		}
	} else {
		vscode.window.showTextDocument(doc, {
			selection: range,
			preserveFocus: false,
		});
	}
}

export function registerPreview(context: vscode.ExtensionContext): {
	postDiff(report: DiffReport | null): void;
	getActivePreviewDoc(): vscode.TextDocument | undefined;
} {
	const panels = new Map<string, PreviewState>();
	let activePreviewDocUri: string | null = null;

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
			const locations = buildLocations(frontmatter);
			const subflows = buildSubflows(frontmatter);
			state.panel.webview.postMessage({
				type: "render",
				dot,
				focusNodeId,
				descriptions,
				locations,
				subflows,
			});
		}
		if ("pendingDiff" in state) {
			const d = state.pendingDiff;
			delete state.pendingDiff;
			state.panel.webview.postMessage(
				d == null
					? ({ type: "clearDiff" } satisfies MessageToWebview)
					: ({ type: "diff", report: d } satisfies MessageToWebview),
			);
		}
	}

	function createPanel(
		doc: vscode.TextDocument,
		focusNodeId?: string,
	): PreviewState {
		const docUri = doc.uri.toString();
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
				const editor = vscode.window.visibleTextEditors.find(
					(e) => e.document === state.doc,
				);
				const cursorId = editor
					? nodeIdAtCursor(analyzeDocument(state.doc), editor.selection.active)
					: undefined;
				jumpToNode(state.doc, msg.nodeId, cursorId === msg.nodeId);
			} else if (msg.type === "openUrl") {
				vscode.env.openExternal(vscode.Uri.parse(msg.url));
			} else if (msg.type === "openFile") {
				const fsPath = resolveLocationFsPath(state.doc.uri.fsPath, msg.path);
				const srcVc = vscode.window.visibleTextEditors.find(
					(e) => e.document === state.doc,
				)?.viewColumn;
				openFileActivatingExisting(fsPath, srcVc);
			} else if (msg.type === "openLocation") {
				const { frontmatter } = analyzeDocument(state.doc);
				const locs = buildLocations(frontmatter)[msg.nodeId] ?? [];
				const srcVc = vscode.window.visibleTextEditors.find(
					(e) => e.document === state.doc,
				)?.viewColumn;
				handleOpenLocation(state.doc.uri.fsPath, locs, srcVc);
			}
		});

		panel.onDidChangeViewState((e) => {
			if (e.webviewPanel.active) {
				activePreviewDocUri = docUri;
			}
		});

		panel.onDidDispose(() => {
			panels.delete(docUri);
			if (activePreviewDocUri === docUri) activePreviewDocUri = null;
		});
		context.subscriptions.push(panel);
		panels.set(docUri, state);
		activePreviewDocUri = docUri;
		return state;
	}

	function postDiff(report: DiffReport | null): void {
		const state = activePreviewDocUri
			? panels.get(activePreviewDocUri)
			: undefined;
		if (!state) return;
		if (state.webviewReady) {
			state.panel.webview.postMessage(
				report == null
					? ({ type: "clearDiff" } satisfies MessageToWebview)
					: ({ type: "diff", report } satisfies MessageToWebview),
			);
		} else {
			state.pendingDiff = report;
		}
	}

	function getActivePreviewDoc(): vscode.TextDocument | undefined {
		return activePreviewDocUri
			? panels.get(activePreviewDocUri)?.doc
			: undefined;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.preview", async () => {
			const editor = requireActivePfdslEditor();
			if (!editor) return;
			const doc = editor.document;
			const docUri = doc.uri.toString();

			const existing = panels.get(docUri);
			if (existing) {
				existing.panel.reveal(vscode.ViewColumn.Beside, true);
				sendUpdate(existing);
				return;
			}

			const result = analyzeDocument(doc);
			const focusNodeId = nodeIdAtCursor(result, editor.selection.active);
			createPanel(doc, focusNodeId);
		}),

		vscode.workspace.onDidChangeTextDocument((e) => {
			const state = panels.get(e.document.uri.toString());
			if (state) sendUpdate(state);
		}),

		vscode.window.onDidChangeTextEditorSelection((e) => {
			const state = panels.get(e.textEditor.document.uri.toString());
			if (!state) return;
			const sel = e.selections[0];
			if (!sel || sel.isEmpty) {
				state.panel.webview.postMessage({
					type: "clearFocus",
				} satisfies MessageToWebview);
				return;
			}
			const selectedText = e.textEditor.document.getText(sel);
			const result = analyzeDocument(state.doc);
			const allIds = new Set(
				result.document.statements
					.flatMap(idsOfStatement)
					.map((id) => id.value),
			);
			if (allIds.has(selectedText)) {
				state.panel.webview.postMessage({
					type: "focus",
					nodeId: selectedText,
				} satisfies MessageToWebview);
			} else {
				state.panel.webview.postMessage({
					type: "clearFocus",
				} satisfies MessageToWebview);
			}
		}),
	);
	return { postDiff, getActivePreviewDoc };
}
