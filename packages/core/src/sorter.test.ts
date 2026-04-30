import { describe, it, expect } from 'vitest';
import { lex } from './lexer.js';
import { parseTokens } from './parser.js';
import { normalize } from './normalizer.js';
import { buildGraph } from './graph.js';
import { sortEdges } from './sorter.js';
import type { NormalizedEdge } from './types/index.js';

function sorted(src: string): NormalizedEdge[] {
  const { tokens } = lex(src);
  const { document } = parseTokens(tokens);
  const { edges, nodeKinds } = normalize(document, null);
  const graph = buildGraph(edges, nodeKinds);
  return sortEdges(edges, graph);
}

describe('sortEdges', () => {
  it('simple chain: input before output', () => {
    const result = sorted('A >> P -> B');
    expect(result[0]).toEqual({ kind: 'input', artifact: 'A', process: 'P' });
    expect(result[1]).toEqual({ kind: 'output', process: 'P', artifact: 'B' });
  });

  it('sequential chain: rank ordering A >> P -> B >> Q -> C', () => {
    const result = sorted('A >> P -> B >> Q -> C');
    const kinds = result.map(e => e.kind);
    expect(kinds).toEqual(['input', 'output', 'input', 'output']);
  });

  it('within same rank: >> before ->', () => {
    const result = sorted('[a, b] >> P -> [x, y]');
    const inputs = result.filter(e => e.kind === 'input');
    const outputs = result.filter(e => e.kind === 'output');
    expect(inputs.length).toBe(2);
    expect(outputs.length).toBe(2);
    const firstOutputIdx = result.findIndex(e => e.kind === 'output');
    const lastInputIdx = result.map(e => e.kind).lastIndexOf('input');
    expect(lastInputIdx).toBeLessThan(firstOutputIdx);
  });

  it('lexicographic ordering within same rank and type', () => {
    const result = sorted('[b, a] >> P -> B');
    const inputs = result.filter(e => e.kind === 'input');
    expect(inputs[0]).toEqual({ kind: 'input', artifact: 'a', process: 'P' });
    expect(inputs[1]).toEqual({ kind: 'input', artifact: 'b', process: 'P' });
  });

  it('feedback edges placed by process rank', () => {
    const result = sorted('req >> design -> spec\nspec >>? design');
    const fbIdx = result.findIndex(e => e.kind === 'feedback');
    const outIdx = result.findIndex(e => e.kind === 'output');
    expect(fbIdx).toBeGreaterThan(-1);
    expect(fbIdx).toBeLessThan(outIdx);
  });

  it('separate connected components: smaller min-ID component first', () => {
    const result = sorted('x >> P2 -> y\na >> P1 -> b');
    expect(result[0]).toMatchObject({ artifact: 'a' });
  });
});
