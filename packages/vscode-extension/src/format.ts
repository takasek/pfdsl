import * as vscode from 'vscode';
import { sortEdges, formatEdges, hasErrors } from '@pfdsl/core';
import { analyzeDocument, LANGUAGE_ID } from './analyze.js';

export function registerFormatter(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(doc) {
      const { edges, graph, diagnostics } = analyzeDocument(doc);
      if (hasErrors(diagnostics)) return [];
      const output = formatEdges(sortEdges(edges, graph));
      const source = doc.getText();
      if (output === source) return [];
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(source.length),
      );
      return [vscode.TextEdit.replace(fullRange, output)];
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, provider),
    vscode.commands.registerCommand('pfdsl.format', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== LANGUAGE_ID) return;
      await vscode.commands.executeCommand('editor.action.formatDocument');
    }),
  );
}
