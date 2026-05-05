import { describe, it, expect } from 'vitest';
import { formatEdges } from './formatter.js';
import { lex } from './lexer.js';
import { parseTokens } from './parser.js';
import { normalize } from './normalizer.js';
import type { NormalizedEdge } from './types/index.js';

describe('formatEdges', () => {
  it('empty list → empty string', () => {
    expect(formatEdges([])).toBe('');
  });

  it('input edge → "artifact >> process\\n"', () => {
    const edges: NormalizedEdge[] = [{ kind: 'input', artifact: 'A', process: 'P' }];
    expect(formatEdges(edges)).toBe('A >> P\n');
  });

  it('feedback edge → "artifact >>? process\\n"', () => {
    const edges: NormalizedEdge[] = [{ kind: 'feedback', artifact: 'A', process: 'P' }];
    expect(formatEdges(edges)).toBe('A >>? P\n');
  });

  it('output edge → "process -> artifact\\n"', () => {
    const edges: NormalizedEdge[] = [{ kind: 'output', process: 'P', artifact: 'B' }];
    expect(formatEdges(edges)).toBe('P -> B\n');
  });

  it('multiple edges: one per line, trailing newline', () => {
    const edges: NormalizedEdge[] = [
      { kind: 'input',  artifact: 'A', process: 'P' },
      { kind: 'output', process: 'P',  artifact: 'B' },
    ];
    expect(formatEdges(edges)).toBe('A >> P\nP -> B\n');
  });

  it('IDs with spaces use as-is (formatter trusts input — known spec gap; output is not re-parseable as one ID)', () => {
    const edges: NormalizedEdge[] = [{ kind: 'input', artifact: 'my artifact', process: 'P' }];
    const out = formatEdges(edges);
    expect(out).toBe('my artifact >> P\n');
    // Document the gap: spaced output is rejected on re-parse (not round-trip safe).
    const { tokens } = lex(out);
    const parsed = parseTokens(tokens);
    const norm = normalize(parsed.document, null);
    const allErrors = [...parsed.diagnostics, ...norm.diagnostics].filter(d => d.severity === 'error');
    expect(allErrors.length).toBeGreaterThan(0);
  });

  it('bare-id edges round-trip through lex/parse/normalize unchanged', () => {
    const edges: NormalizedEdge[] = [
      { kind: 'input',  artifact: 'A', process: 'P' },
      { kind: 'output', process: 'P', artifact: 'B' },
    ];
    const { tokens } = lex(formatEdges(edges));
    const parsed = parseTokens(tokens);
    const norm = normalize(parsed.document, null);
    const allErrors = [...parsed.diagnostics, ...norm.diagnostics].filter(d => d.severity === 'error');
    expect(allErrors).toHaveLength(0);
    expect(norm.edges).toEqual(edges);
  });

  it('isolated nodes output after edges', () => {
    const edges: NormalizedEdge[] = [
      { kind: 'input',  artifact: 'A', process: 'P' },
      { kind: 'output', process: 'P', artifact: 'B' },
    ];
    const result = formatEdges(edges, ['isolated_a', 'isolated_b']);
    expect(result).toBe('A >> P\nP -> B\nisolated_a\nisolated_b\n');
  });

  it('isolated-only (no edges) output', () => {
    const result = formatEdges([], ['lone']);
    expect(result).toBe('lone\n');
  });
});
