import { appendFileSync } from "node:fs";
import * as vscode from "vscode";

let sequence = 0;
const identities = new WeakMap<object, number>();
function id(value: object) {
	let n = identities.get(value);
	if (!n) {
		n = ++sequence;
		identities.set(value, n);
	}
	return n;
}
function doc(d: vscode.TextDocument) {
	return {
		id: id(d),
		uri: d.uri.toString(),
		version: d.version,
		dirty: d.isDirty,
		closed: d.isClosed,
	};
}
function editor(e: vscode.TextEditor | undefined) {
	return e ? { id: id(e), column: e.viewColumn, doc: doc(e.document) } : null;
}
function tab(t: vscode.Tab) {
	return {
		id: id(t),
		label: t.label,
		active: t.isActive,
		dirty: t.isDirty,
		preview: t.isPreview,
		group: id(t.group),
		inputType: t.input?.constructor?.name,
		uri:
			t.input instanceof vscode.TabInputText
				? t.input.uri.toString()
				: undefined,
	};
}
export function trace(event: string, details: unknown = {}) {
	const path = process.env.PFDSL_DIAG_LOG;
	if (!path) return;
	try {
		appendFileSync(
			path,
			`${JSON.stringify({
				wallMs: Date.now(),
				event,
				details,
				active: editor(vscode.window.activeTextEditor),
				visible: vscode.window.visibleTextEditors.map(editor),
				groups: vscode.window.tabGroups.all.map((g) => ({
					id: id(g),
					column: g.viewColumn,
					active: g.isActive,
					tabs: g.tabs.map(tab),
				})),
			})}\n`,
		);
	} catch (error) {
		console.error("PFDSL diagnostic logging failed", error);
	}
}
export function registerTrace(context: vscode.ExtensionContext) {
	if (!process.env.PFDSL_DIAG_LOG) return;
	context.subscriptions.push(
		vscode.window.tabGroups.onDidChangeTabs((e) =>
			trace("tabs", {
				opened: e.opened.map(tab),
				closed: e.closed.map(tab),
				changed: e.changed.map(tab),
			}),
		),
		vscode.window.tabGroups.onDidChangeTabGroups((e) =>
			trace("groups", {
				opened: e.opened.map(id),
				closed: e.closed.map(id),
				changed: e.changed.map(id),
			}),
		),
		vscode.window.onDidChangeVisibleTextEditors(() => trace("visible-editors")),
		vscode.window.onDidChangeActiveTextEditor(() => trace("active-editor")),
		vscode.workspace.onDidOpenTextDocument((d) =>
			trace("document-open", doc(d)),
		),
		vscode.workspace.onDidCloseTextDocument((d) =>
			trace("document-close", doc(d)),
		),
		vscode.workspace.onDidSaveTextDocument((d) =>
			trace("document-save", doc(d)),
		),
		vscode.workspace.onDidChangeTextDocument((e) =>
			trace("document-change", {
				doc: doc(e.document),
				changes: e.contentChanges.length,
			}),
		),
	);
	trace("trace-ready", {
		vscodeVersion: vscode.version,
		trusted: vscode.workspace.isTrusted,
	});
}

let requestSequence = 0;
export function traceShowTextDocument(
	route: string,
	target: vscode.TextDocument | vscode.Uri,
	options?: vscode.TextDocumentShowOptions,
): Thenable<vscode.TextEditor> {
	const requestId = ++requestSequence;
	const uri =
		target instanceof vscode.Uri ? target.toString() : target.uri.toString();
	trace("showTextDocument-issued", { requestId, route, uri, options });
	const result =
		target instanceof vscode.Uri
			? vscode.window.showTextDocument(target, options)
			: vscode.window.showTextDocument(target, options);
	result.then(
		(value) =>
			trace("showTextDocument-resolved", {
				requestId,
				route,
				uri,
				editor: editor(value),
			}),
		(error) =>
			trace("showTextDocument-rejected", {
				requestId,
				route,
				uri,
				error: String(error),
			}),
	);
	return result;
}
