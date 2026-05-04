import * as vscode from 'vscode';
import { renderGraph } from '@pfdsl/preview-engine';
import { analyze } from './analyze.js';

interface PreviewState {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
}

let current: PreviewState | null = null;

async function renderForUri(uri: vscode.Uri): Promise<{ svg?: string; error?: string }> {
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch (e) {
    return { error: `Failed to open ${uri.fsPath}: ${(e as Error).message}` };
  }
  const { graph, frontmatter, diagnostics } = analyze(doc.getText());
  const fatal = diagnostics.find(d => d.severity === 'error');
  if (!graph || fatal) {
    return { error: fatal ? `${fatal.code}: ${fatal.message}` : 'No graph available' };
  }
  try {
    const svg = await renderGraph(graph, frontmatter, { format: 'svg' });
    return { svg };
  } catch (e) {
    return { error: `Render failed: ${(e as Error).message}` };
  }
}

function buildHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;" />
<style>
  body { margin: 0; padding: 12px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  svg { max-width: 100%; height: auto; }
  .err { color: var(--vscode-errorForeground); white-space: pre-wrap; font-family: var(--vscode-editor-font-family); }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function updatePreview(state: PreviewState): Promise<void> {
  const { svg, error } = await renderForUri(state.uri);
  state.panel.title = `PFDSL Preview — ${state.uri.path.split('/').pop() ?? ''}`;
  state.panel.webview.html = buildHtml(
    error ? `<div class="err">${escapeHtml(error)}</div>` : svg ?? '',
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

export function registerPreview(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('pfdsl.preview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pfdsl') {
        vscode.window.showInformationMessage('Open a .pfdsl file first.');
        return;
      }
      const uri = editor.document.uri;

      if (current) {
        current.uri = uri;
        current.panel.reveal(vscode.ViewColumn.Beside, true);
        await updatePreview(current);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'pfdslPreview',
        'PFDSL Preview',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: false, retainContextWhenHidden: true },
      );
      current = { panel, uri };
      panel.onDidDispose(() => { current = null; });
      await updatePreview(current);
    }),

    vscode.workspace.onDidSaveTextDocument(async doc => {
      if (current && doc.uri.toString() === current.uri.toString()) {
        await updatePreview(current);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(async e => {
      if (current && e.document.uri.toString() === current.uri.toString()) {
        await updatePreview(current);
      }
    }),
  );
}
