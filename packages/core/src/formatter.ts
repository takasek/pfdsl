import type { NormalizedEdge } from './types/index.js';

export function formatEdges(sortedEdges: NormalizedEdge[], sortedIsolated: string[] = []): string {
  const lines: string[] = [];
  for (const e of sortedEdges) {
    if (e.kind === 'input')    lines.push(`${e.artifact} >> ${e.process}`);
    else if (e.kind === 'feedback') lines.push(`${e.artifact} >>? ${e.process}`);
    else lines.push(`${e.process} -> ${e.artifact}`);
  }
  for (const id of sortedIsolated) lines.push(id);
  if (lines.length === 0) return '';
  return lines.join('\n') + '\n';
}
