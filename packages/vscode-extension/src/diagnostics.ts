import * as vscode from 'vscode';
import type { Diagnostic as CoreDiagnostic, Range as CoreRange } from '@pfdsl/core';
import { analyze } from './analyze.js';

const SEVERITY_MAP: Record<CoreDiagnostic['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export function toVscodeRange(r: CoreRange): vscode.Range {
  return new vscode.Range(
    Math.max(0, r.start.line - 1),
    Math.max(0, r.start.column - 1),
    Math.max(0, r.end.line - 1),
    Math.max(0, r.end.column - 1),
  );
}

function toVscodeDiagnostic(d: CoreDiagnostic): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(toVscodeRange(d.range), d.message, SEVERITY_MAP[d.severity]);
  diag.code = d.code;
  diag.source = 'pfdsl';
  return diag;
}

export function refreshDiagnostics(
  doc: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): void {
  if (doc.languageId !== 'pfdsl') return;
  const { diagnostics } = analyze(doc.getText());
  collection.set(doc.uri, diagnostics.map(toVscodeDiagnostic));
}

export function registerDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('pfdsl');
  context.subscriptions.push(collection);

  for (const doc of vscode.workspace.textDocuments) refreshDiagnostics(doc, collection);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => refreshDiagnostics(doc, collection)),
    vscode.workspace.onDidChangeTextDocument(e => refreshDiagnostics(e.document, collection)),
    vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)),
  );

  return collection;
}
