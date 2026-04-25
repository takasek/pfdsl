import { describe, it, expect } from 'vitest';
import { lex } from './lexer.js';
import { parseTokens } from './parser.js';
import type { ChainStatement, InputEdgeStatement, FeedbackEdgeStatement, OutputEdgeStatement } from './types/index.js';

function parse(src: string) {
  const { tokens } = lex(src);
  return parseTokens(tokens);
}

describe('parseTokens', () => {
  it('empty input → empty document', () => {
    const { document } = parse('');
    expect(document.statements).toHaveLength(0);
  });

  it('chain A >> P -> B', () => {
    const { document, diagnostics } = parse('A >> P -> B');
    expect(diagnostics).toHaveLength(0);
    expect(document.statements).toHaveLength(1);
    const stmt = document.statements[0] as ChainStatement;
    expect(stmt.type).toBe('chain');
    expect(stmt.head.ids[0]?.value).toBe('A');
    expect(stmt.segments).toHaveLength(1);
    expect(stmt.segments[0]?.op).toBe('>>');
    expect(stmt.segments[0]?.process.value).toBe('P');
    expect(stmt.segments[0]?.output.ids[0]?.value).toBe('B');
  });

  it('extended chain A >> P -> B >> Q -> C', () => {
    const { document } = parse('A >> P -> B >> Q -> C');
    const stmt = document.statements[0] as ChainStatement;
    expect(stmt.type).toBe('chain');
    expect(stmt.segments).toHaveLength(2);
    expect(stmt.segments[1]?.process.value).toBe('Q');
    expect(stmt.segments[1]?.output.ids[0]?.value).toBe('C');
  });

  it('input edge A >> P', () => {
    const { document } = parse('A >> P');
    const stmt = document.statements[0] as InputEdgeStatement;
    expect(stmt.type).toBe('input-edge');
    expect(stmt.artifact.ids[0]?.value).toBe('A');
    expect(stmt.process.value).toBe('P');
  });

  it('feedback edge A >>? P', () => {
    const { document } = parse('A >>? P');
    const stmt = document.statements[0] as FeedbackEdgeStatement;
    expect(stmt.type).toBe('feedback-edge');
    expect(stmt.artifact.ids[0]?.value).toBe('A');
    expect(stmt.process.value).toBe('P');
  });

  it('output edge P -> A', () => {
    const { document } = parse('P -> A');
    const stmt = document.statements[0] as OutputEdgeStatement;
    expect(stmt.type).toBe('output-edge');
    expect(stmt.process.value).toBe('P');
    expect(stmt.artifact.ids[0]?.value).toBe('A');
  });

  it('set notation [a, b] >> P -> [x, y]', () => {
    const { document } = parse('[a, b] >> P -> [x, y]');
    const stmt = document.statements[0] as ChainStatement;
    expect(stmt.head.ids.map(i => i.value)).toEqual(['a', 'b']);
    expect(stmt.segments[0]?.output.ids.map(i => i.value)).toEqual(['x', 'y']);
  });

  it('multiple statements separated by newline', () => {
    const { document } = parse('A >> P\nB >> Q');
    expect(document.statements).toHaveLength(2);
  });

  it('multiple statements separated by semicolon', () => {
    const { document } = parse('A >> P; B >> Q');
    expect(document.statements).toHaveLength(2);
  });

  it('syntax error: produces diagnostic and continues', () => {
    const { document, diagnostics } = parse('>> garbage\nA >> P');
    expect(diagnostics.length).toBeGreaterThan(0);
    // Should still parse the valid second statement
    expect(document.statements.length).toBeGreaterThan(0);
  });

  it('chain with feedback op: A >>? P -> B', () => {
    const { document } = parse('A >>? P -> B');
    const stmt = document.statements[0] as ChainStatement;
    expect(stmt.segments[0]?.op).toBe('>>?');
  });
});
