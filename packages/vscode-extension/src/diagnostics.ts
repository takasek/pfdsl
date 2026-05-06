import type {
	Diagnostic as CoreDiagnostic,
	Range as CoreRange,
} from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, dropAnalyzeCache, LANGUAGE_ID } from "./analyze.js";

const SEVERITY_MAP: Record<
	CoreDiagnostic["severity"],
	vscode.DiagnosticSeverity
> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	info: vscode.DiagnosticSeverity.Information,
};

function toVscodeRange(r: CoreRange): vscode.Range {
	return new vscode.Range(
		r.start.line - 1,
		r.start.column - 1,
		r.end.line - 1,
		r.end.column - 1,
	);
}

function toVscodeDiagnostic(d: CoreDiagnostic): vscode.Diagnostic {
	const diag = new vscode.Diagnostic(
		toVscodeRange(d.range),
		d.message,
		SEVERITY_MAP[d.severity],
	);
	diag.code = d.code;
	diag.source = LANGUAGE_ID;
	return diag;
}

function refreshDiagnostics(
	doc: vscode.TextDocument,
	collection: vscode.DiagnosticCollection,
): void {
	if (doc.languageId !== LANGUAGE_ID) return;
	const { diagnostics } = analyzeDocument(doc);
	collection.set(doc.uri, diagnostics.map(toVscodeDiagnostic));
}

export function registerDiagnostics(
	context: vscode.ExtensionContext,
): vscode.DiagnosticCollection {
	const collection = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
	context.subscriptions.push(collection);

	for (const doc of vscode.workspace.textDocuments)
		refreshDiagnostics(doc, collection);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((doc) =>
			refreshDiagnostics(doc, collection),
		),
		vscode.workspace.onDidChangeTextDocument((e) =>
			refreshDiagnostics(e.document, collection),
		),
		vscode.workspace.onDidCloseTextDocument((doc) => {
			collection.delete(doc.uri);
			dropAnalyzeCache(doc.uri);
		}),
	);

	return collection;
}
