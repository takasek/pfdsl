import type { Graph, Frontmatter, NodeKind } from '@pfdsl/core';

export interface ExportOptions {
  /** Override rankdir; defaults to frontmatter.layout.direction or 'LR'. */
  rankdir?: 'LR' | 'RL' | 'TB' | 'BT';
  /** Color for feedback edges. Default '#888888'. */
  feedbackColor?: string;
  /** Title for the graph; defaults to frontmatter.title. */
  graphLabel?: string;
}

const DEFAULT_FEEDBACK_COLOR = '#888888';

const QUOTE_BACKSLASH_RE = /\\/g;
const QUOTE_DQUOTE_RE = /"/g;
const QUOTE_NEWLINE_RE = /\n/g;

export function exportDot(
  graph: Graph,
  frontmatter: Frontmatter | null = null,
  options: ExportOptions = {}
): string {
  const rankdir = options.rankdir ?? frontmatter?.layout?.direction ?? 'LR';
  const feedbackColor = options.feedbackColor ?? DEFAULT_FEEDBACK_COLOR;
  const graphLabel = options.graphLabel ?? frontmatter?.title;

  const lines: string[] = [];
  lines.push('digraph PFDSL {');
  lines.push(`  rankdir=${rankdir};`);
  if (graphLabel !== undefined) {
    lines.push(`  label=${quote(String(graphLabel))};`);
    lines.push('  labelloc="t";');
  }
  lines.push('');

  const nodeIds = [...graph.nodes.keys()].sort();
  for (const id of nodeIds) {
    const kind = graph.nodes.get(id)!;
    lines.push(`  ${quote(id)} ${nodeAttrs(id, kind, frontmatter)};`);
  }

  if (graph.primaryEdges.length > 0 || graph.feedbackEdges.length > 0) {
    lines.push('');
  }

  for (const e of graph.primaryEdges) {
    lines.push(`  ${quote(e.from)} -> ${quote(e.to)};`);
  }
  for (const e of graph.feedbackEdges) {
    lines.push(
      `  ${quote(e.artifact)} -> ${quote(e.process)} [style=dashed, color=${quote(feedbackColor)}, constraint=false];`
    );
  }

  lines.push('}');
  return lines.join('\n') + '\n';
}

function nodeAttrs(id: string, kind: NodeKind, fm: Frontmatter | null): string {
  const shape = kind === 'process' ? 'ellipse' : 'box';
  const title = lookupTitle(id, kind, fm);
  const label = title ? `${id}\n${title}` : id;
  return `[shape=${shape}, label=${quote(label)}]`;
}

function lookupTitle(id: string, kind: NodeKind, fm: Frontmatter | null): string | undefined {
  if (!fm) return undefined;
  const meta = kind === 'process' ? fm.process?.[id] : fm.artifact?.[id];
  return meta?.title;
}

function quote(s: string): string {
  return '"' + s
    .replace(QUOTE_BACKSLASH_RE, '\\\\')
    .replace(QUOTE_DQUOTE_RE, '\\"')
    .replace(QUOTE_NEWLINE_RE, '\\n') + '"';
}
