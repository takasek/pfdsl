import { type DiffReport, resolveLocationFsPath } from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter";
import * as vscode from "vscode";
import {
	analyzeDocument,
	resolveEffectiveFrontmatterForUri,
} from "./analyze.js";
import { type DirectoryAccess, expandDirectory } from "./expand-directory.js";
import { findFrontmatterDefinition } from "./jump.js";
import {
	buildDescriptions,
	buildLocations,
	buildSubflows,
} from "./location-utils.js";
import type { MessageFromWebview, MessageToWebview } from "./messages.js";
import {
	allIdsOfDocument,
	buildHtml,
	idsOfStatement,
	nodeIdAtCursor,
} from "./preview-logic.js";
import { requireActivePfdslEditor } from "./utils.js";

interface PreviewState {
	panel: vscode.WebviewPanel;
	doc: vscode.TextDocument;
	webviewReady: boolean;
	pendingFocusNodeId?: string;
	pendingDiff?: DiffReport | null; // null = clearDiff
}

/** The vscode filesystem, shaped for expandDirectory: fsPaths in, fsPaths out. */
const workspaceDirectoryAccess: DirectoryAccess = {
	read: async (path) =>
		(await vscode.workspace.fs.readDirectory(vscode.Uri.file(path))).map(
			([name, type]) => ({
				name,
				isDirectory: type === vscode.FileType.Directory,
			}),
		),
	join: (path, name) => vscode.Uri.joinPath(vscode.Uri.file(path), name).fsPath,
};

type QuickPickLocationItem = vscode.QuickPickItem & {
	fsPath?: string;
	url?: string;
};

async function handleOpenLocation(
	docFsPath: string,
	locs: string[],
	fallbackViewColumn?: vscode.ViewColumn,
	basePath?: string,
): Promise<void> {
	if (locs.length === 0) return;

	const items: QuickPickLocationItem[] = [];
	for (const loc of locs) {
		if (loc.includes("://")) {
			const url = new URL(loc);
			items.push({ label: url.hostname, description: loc, url: loc });
		} else {
			const resolvedPath = resolveLocationFsPath(docFsPath, loc, basePath);
			const resolvedUri = vscode.Uri.file(resolvedPath);
			let stat: vscode.FileStat | undefined;
			try {
				stat = await vscode.workspace.fs.stat(resolvedUri);
			} catch {
				// treat as file if stat fails
			}
			if (stat?.type === vscode.FileType.Directory) {
				const children = await expandDirectory(
					workspaceDirectoryAccess,
					resolvedPath,
				);
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
		const effectiveFrontmatter = resolveEffectiveFrontmatterForUri(
			doc.uri,
			frontmatter,
		);
		return { dot: exportDot(graph, effectiveFrontmatter) };
	} catch (e) {
		return { error: `Export failed: ${(e as Error).message}` };
	}
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
			webviewScriptUri.toString(),
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
				const { frontmatter } = analyzeDocument(state.doc);
				const fsPath = resolveLocationFsPath(
					state.doc.uri.fsPath,
					msg.path,
					frontmatter?.basePath,
				);
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
				handleOpenLocation(
					state.doc.uri.fsPath,
					locs,
					srcVc,
					frontmatter?.basePath,
				);
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
			const allIds = allIdsOfDocument(analyzeDocument(state.doc));
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
