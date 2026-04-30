import { describe, it, expect } from 'vitest';
import { lex } from './lexer.js';
import { parseTokens } from './parser.js';
import { normalize } from './normalizer.js';
import type { NormalizedEdge } from './types/index.js';

function edges(src: string, fm = null): NormalizedEdge[] {
  const { tokens } = lex(src);
  const { document } = parseTokens(tokens);
  return normalize(document, fm).edges.edges;
}

describe('normalize', () => {
  it('chain A >> P -> B produces 2 edges', () => {
    const result = edges('A >> P -> B');
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ kind: 'input', artifact: 'A', process: 'P' });
    expect(result).toContainEqual({ kind: 'output', process: 'P', artifact: 'B' });
  });

  it('extended chain A >> P -> B >> Q -> C produces 4 edges', () => {
    const result = edges('A >> P -> B >> Q -> C');
    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ kind: 'input', artifact: 'A', process: 'P' });
    expect(result).toContainEqual({ kind: 'output', process: 'P', artifact: 'B' });
    expect(result).toContainEqual({ kind: 'input', artifact: 'B', process: 'Q' });
    expect(result).toContainEqual({ kind: 'output', process: 'Q', artifact: 'C' });
  });

  it('set [a,b] >> P -> [x,y] produces 4 edges (Cartesian product)', () => {
    const result = edges('[a, b] >> P -> [x, y]');
    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ kind: 'input', artifact: 'a', process: 'P' });
    expect(result).toContainEqual({ kind: 'input', artifact: 'b', process: 'P' });
    expect(result).toContainEqual({ kind: 'output', process: 'P', artifact: 'x' });
    expect(result).toContainEqual({ kind: 'output', process: 'P', artifact: 'y' });
  });

  it('feedback edge A >>? P produces feedback edge', () => {
    const result = edges('A >>? P');
    expect(result).toContainEqual({ kind: 'feedback', artifact: 'A', process: 'P' });
  });

  it('duplicate edge produces warning diagnostic', () => {
    const { tokens } = lex('A >> P\nA >> P');
    const { document } = parseTokens(tokens);
    const { diagnostics } = normalize(document, null);
    expect(diagnostics.some(d => d.severity === 'warning' && d.code === 'N003')).toBe(true);
  });

  it('type contradiction produces error diagnostic', () => {
    const { tokens } = lex('A >> P\nB >> A');
    const { document } = parseTokens(tokens);
    const { diagnostics } = normalize(document, null);
    expect(diagnostics.some(d => d.severity === 'error' && d.code === 'N002')).toBe(true);
  });

  it('front matter artifact declaration takes priority', () => {
    const fm = { artifact: { P: { title: 'Override' } } };
    const { diagnostics } = (() => {
      const { tokens } = lex('A >> P');
      const { document } = parseTokens(tokens);
      return normalize(document, fm as any);
    })();
    expect(diagnostics.some(d => d.code === 'N002')).toBe(true);
  });

  it('nodeKinds: infers artifact and process kinds', () => {
    const { tokens } = lex('A >> P -> B');
    const { document } = parseTokens(tokens);
    const { nodeKinds } = normalize(document, null);
    expect(nodeKinds.get('A')).toBe('artifact');
    expect(nodeKinds.get('P')).toBe('process');
    expect(nodeKinds.get('B')).toBe('artifact');
  });
});
