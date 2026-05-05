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

  it('feedback edges placed by process rank (spec §14.5): sits between target process inputs and outputs', () => {
    // Chain: req(0) >> design(1) -> spec(2) >> impl(3) -> code(4)
    // Feedback spec >>? impl: source artifact is in main component; edge rank = impl rank (3).
    // At rank 3, kind ordering puts feedback (1) before output (2).
    const result = sorted('req >> design -> spec\nspec >> impl -> code\nspec >>? impl');
    expect(result).toEqual([
      { kind: 'input',    artifact: 'req',  process: 'design' },
      { kind: 'output',   process: 'design', artifact: 'spec' },
      { kind: 'input',    artifact: 'spec', process: 'impl' },
      { kind: 'feedback', artifact: 'spec', process: 'impl' },
      { kind: 'output',   process: 'impl',  artifact: 'code' },
    ]);
  });

  it('separate connected components: smaller min-ID component first', () => {
    const result = sorted('x >> P2 -> y\na >> P1 -> b');
    expect(result[0]).toMatchObject({ artifact: 'a' });
  });

  it('cyclic primary graph: terminates and emits all edges with rank-0 fallback', () => {
    // A -> P1 -> B -> P2 -> A forms a cycle on the primary graph.
    // No source ⇒ all ranks fall back to 0 ⇒ stable sort by kind then lex key.
    const start = Date.now();
    const result = sorted('A >> P1 -> B\nB >> P2 -> A');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result).toEqual([
      { kind: 'input',  artifact: 'A',  process: 'P1' },
      { kind: 'input',  artifact: 'B',  process: 'P2' },
      { kind: 'output', process: 'P1', artifact: 'B'  },
      { kind: 'output', process: 'P2', artifact: 'A'  },
    ]);
  });
});
