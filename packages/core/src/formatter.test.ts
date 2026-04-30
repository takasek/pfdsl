import { describe, it, expect } from 'vitest';
import { formatEdges } from './formatter.js';
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

  it('IDs with spaces use as-is (formatter trusts input)', () => {
    const edges: NormalizedEdge[] = [{ kind: 'input', artifact: 'my artifact', process: 'P' }];
    expect(formatEdges(edges)).toBe('my artifact >> P\n');
  });
});
