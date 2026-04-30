import { describe, it, expect } from 'vitest';
import { lex } from './lexer.js';
import { parseTokens } from './parser.js';
import { normalize } from './normalizer.js';
import { buildGraph } from './graph.js';
import { validate } from './validator.js';
import type { Frontmatter } from './types/index.js';

function diagnose(src: string, fm: Frontmatter | null = null) {
  const { tokens } = lex(src);
  const { document } = parseTokens(tokens);
  const { edges, nodeKinds } = normalize(document, fm);
  const graph = buildGraph(edges, nodeKinds);
  return validate(edges, graph, fm);
}

function codes(src: string, fm: Frontmatter | null = null): string[] {
  return diagnose(src, fm).map(d => d.code);
}

describe('validate', () => {
  it('valid graph: no diagnostics', () => {
    expect(diagnose('A >> P -> B')).toHaveLength(0);
  });

  it('V001: single-source violation (two processes generate same artifact)', () => {
    expect(codes('A >> P -> C\nB >> Q -> C')).toContain('V001');
  });

  it('V002: process with no inputs', () => {
    expect(codes('P -> B')).toContain('V002');
  });

  it('V003: process with no outputs', () => {
    expect(codes('A >> P')).toContain('V003');
  });

  it('V004: parts member is a process', () => {
    const fm: Frontmatter = { artifact: { C: { parts: ['P'] } } };
    const diags = diagnose('A >> P -> B', fm);
    expect(diags.map(d => d.code)).toContain('V004');
  });

  it('V005: parts self-reference', () => {
    const fm: Frontmatter = { artifact: { A: { parts: ['A'] } } };
    const diags = diagnose('A >> P -> B', fm);
    expect(diags.map(d => d.code)).toContain('V005');
  });

  it('V006: parts cycle', () => {
    const fm: Frontmatter = {
      artifact: { A: { parts: ['B'] }, B: { parts: ['A'] } },
    };
    const diags = diagnose('', fm);
    expect(diags.map(d => d.code)).toContain('V006');
  });

  it('valid chain: no errors', () => {
    expect(diagnose('req >> design -> spec\nspec >> impl -> code')).toHaveLength(0);
  });
});
