import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph.js';
import type { EdgeSet } from './types/index.js';

describe('buildGraph', () => {
  it('input edges: artifact→process in primaryEdges', () => {
    const edges: EdgeSet = { edges: [{ kind: 'input', artifact: 'A', process: 'P' }] };
    const kinds = new Map([['A', 'artifact' as const], ['P', 'process' as const]]);
    const g = buildGraph(edges, kinds);
    expect(g.primaryEdges).toContainEqual({ from: 'A', to: 'P', kind: 'input' });
  });

  it('output edges: process→artifact in primaryEdges', () => {
    const edges: EdgeSet = { edges: [{ kind: 'output', process: 'P', artifact: 'B' }] };
    const kinds = new Map([['P', 'process' as const], ['B', 'artifact' as const]]);
    const g = buildGraph(edges, kinds);
    expect(g.primaryEdges).toContainEqual({ from: 'P', to: 'B', kind: 'output' });
  });

  it('feedback edges go to feedbackEdges, not primaryEdges', () => {
    const edges: EdgeSet = { edges: [{ kind: 'feedback', artifact: 'A', process: 'P' }] };
    const kinds = new Map([['A', 'artifact' as const], ['P', 'process' as const]]);
    const g = buildGraph(edges, kinds);
    expect(g.primaryEdges).toHaveLength(0);
    expect(g.feedbackEdges).toContainEqual({ artifact: 'A', process: 'P' });
  });

  it('nodes map is populated from nodeKinds', () => {
    const edges: EdgeSet = { edges: [] };
    const kinds = new Map([['A', 'artifact' as const], ['P', 'process' as const]]);
    const g = buildGraph(edges, kinds);
    expect(g.nodes.get('A')).toBe('artifact');
    expect(g.nodes.get('P')).toBe('process');
  });
});
