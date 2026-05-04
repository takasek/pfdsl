import * as vscode from 'vscode';
import { renderGraph } from '@pfdsl/preview-engine';
import { analyzeDocument, LANGUAGE_ID } from './analyze.js';

interface PreviewState {
  panel: vscode.WebviewPanel;
  doc: vscode.TextDocument;
}

async function renderForDocument(doc: vscode.TextDocument): Promise<{ svg?: string; error?: string }> {
  const { graph, frontmatter, diagnostics } = analyzeDocument(doc);
  const fatal = diagnostics.find(d => d.severity === 'error');
  if (fatal) return { error: `${fatal.code}: ${fatal.message}` };
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

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => HTML_ESCAPES[c]!);
}

export function registerPreview(context: vscode.ExtensionContext): void {
  let current: PreviewState | null = null;

  async function update(state: PreviewState): Promise<void> {
    const { svg, error } = await renderForDocument(state.doc);
    state.panel.title = `PFDSL Preview — ${state.doc.uri.path.split('/').pop() ?? ''}`;
    state.panel.webview.html = buildHtml(
      error ? `<div class="err">${escapeHtml(error)}</div>` : svg ?? '',
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('pfdsl.preview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== LANGUAGE_ID) {
        vscode.window.showInformationMessage('Open a .pfdsl file first.');
        return;
      }
      const doc = editor.document;

      if (current) {
        current.doc = doc;
        current.panel.reveal(vscode.ViewColumn.Beside, true);
        await update(current);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'pfdslPreview',
        'PFDSL Preview',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: false, retainContextWhenHidden: true },
      );
      context.subscriptions.push(panel);
      current = { panel, doc };
      panel.onDidDispose(() => { current = null; });
      await update(current);
    }),

    vscode.workspace.onDidChangeTextDocument(async e => {
      if (current && e.document === current.doc) {
        await update(current);
      }
    }),
  );
}
