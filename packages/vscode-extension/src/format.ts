import * as vscode from 'vscode';
import { formatSource, LANGUAGE_ID } from './analyze.js';

export function registerFormatter(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(doc) {
      const source = doc.getText();
      const { output, diagnostics } = formatSource(source);
      const hasError = diagnostics.some(d => d.severity === 'error');
      if (hasError) return [];
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
