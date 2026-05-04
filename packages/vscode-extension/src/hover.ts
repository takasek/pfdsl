import * as vscode from 'vscode';
import { analyze } from './analyze.js';

const ID_RE = /[\p{L}\p{N}_][\p{L}\p{N}_-]*/u;

export function registerHover(context: vscode.ExtensionContext): void {
  const provider: vscode.HoverProvider = {
    provideHover(doc, pos) {
      const range = doc.getWordRangeAtPosition(pos, ID_RE);
      if (!range) return null;
      const id = doc.getText(range);

      const { frontmatter, nodeKinds } = analyze(doc.getText());
      const kind = nodeKinds.get(id);
      if (!kind) return null;

      const lines: string[] = [`**${id}** _(${kind})_`];
      const meta = kind === 'artifact'
        ? frontmatter?.artifact?.[id]
        : frontmatter?.process?.[id];

      if (meta) {
        if (meta.title) lines.push(`title: ${meta.title}`);
        if (typeof (meta as Record<string, unknown>).owner === 'string') {
          lines.push(`owner: ${(meta as Record<string, unknown>).owner as string}`);
        }
        if (kind === 'artifact') {
          const am = meta as { status?: string; tags?: string[]; parts?: string[] };
          if (am.status) lines.push(`status: ${am.status}`);
          if (am.tags?.length) lines.push(`tags: ${am.tags.join(', ')}`);
          if (am.parts?.length) lines.push(`parts: ${am.parts.join(', ')}`);
        }
      }

      const md = new vscode.MarkdownString(lines.join('  \n'));
      md.isTrusted = false;
      return new vscode.Hover(md, range);
    },
  };

  context.subscriptions.push(vscode.languages.registerHoverProvider('pfdsl', provider));
}
