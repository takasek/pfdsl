import type {
	Diagnostic as CoreDiagnostic,
	Range as CoreRange,
	DiagnosticSeverity,
} from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, dropAnalyzeCache, LANGUAGE_ID } from "./analyze.js";

export const SEVERITY_MAP: Record<
	DiagnosticSeverity,
	vscode.DiagnosticSeverity
> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	info: vscode.DiagnosticSeverity.Information,
};

export interface VscodeRangeLike {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export function coreRangeToVscode(r: CoreRange): VscodeRangeLike {
	return {
		startLine: r.start.line - 1,
		startColumn: r.start.column - 1,
		endLine: r.end.line - 1,
		endColumn: r.end.column - 1,
	};
}

function toVscodeRange(r: CoreRange): vscode.Range {
	const { startLine, startColumn, endLine, endColumn } = coreRangeToVscode(r);
	return new vscode.Range(startLine, startColumn, endLine, endColumn);
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
