import type { NormalizedEdge } from './types/index.js';

export function formatEdges(sortedEdges: NormalizedEdge[]): string {
  if (sortedEdges.length === 0) return '';
  return sortedEdges.map(e => {
    if (e.kind === 'input')    return `${e.artifact} >> ${e.process}`;
    if (e.kind === 'feedback') return `${e.artifact} >>? ${e.process}`;
    return `${e.process} -> ${e.artifact}`;
  }).join('\n') + '\n';
}
