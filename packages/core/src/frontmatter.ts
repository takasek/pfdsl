import { parse as parseYaml } from 'yaml';
import type { Frontmatter, LoadResult } from './types/index.js';
import type { Diagnostic } from './types/index.js';

export function loadFrontmatter(source: string): LoadResult {
  if (!source.startsWith('---')) {
    return { frontmatter: null, body: source, bodyStartLine: 1, diagnostics: [] };
  }

  const lines = source.split('\n');
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trimEnd() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    const diag: Diagnostic = {
      severity: 'error',
      code: 'FM001',
      message: 'Unclosed front matter: missing closing ---',
      range: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 4, offset: 3 } },
    };
    return { frontmatter: null, body: source, bodyStartLine: 1, diagnostics: [diag] };
  }

  const yamlText = lines.slice(1, closingIndex).join('\n');
  const body = lines.slice(closingIndex + 1).join('\n');
  const bodyStartLine = closingIndex + 2;

  const diagnostics: Diagnostic[] = [];
  let frontmatter: Frontmatter | null = null;

  try {
    const parsed = parseYaml(yamlText);
    if (parsed != null && typeof parsed === 'object') {
      frontmatter = parsed as Frontmatter;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push({
      severity: 'error',
      code: 'FM002',
      message: `Invalid YAML in front matter: ${msg}`,
      range: { start: { line: 2, column: 1, offset: 4 }, end: { line: 2, column: 1, offset: 4 } },
    });
  }

  return { frontmatter, body, bodyStartLine, diagnostics };
}
