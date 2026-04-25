import { describe, it, expect } from 'vitest';
import { lex } from './lexer.js';
import type { TokenType } from './types/index.js';

function types(src: string): TokenType[] {
  return lex(src).tokens.map(t => t.type);
}

function values(src: string): string[] {
  return lex(src).tokens.map(t => t.value);
}

describe('lex', () => {
  it('empty input → [EOF]', () => {
    expect(types('')).toEqual(['EOF']);
  });

  it('>>? takes priority over >>', () => {
    expect(types('>>?')).toEqual(['ARROW_FEEDBACK', 'EOF']);
  });

  it('>> is recognized', () => {
    expect(types('>>')).toEqual(['ARROW_INPUT', 'EOF']);
  });

  it('-> is recognized', () => {
    expect(types('->')).toEqual(['ARROW_OUTPUT', 'EOF']);
  });

  it('brackets comma semicolon', () => {
    expect(types('[],;')).toEqual(['LBRACKET', 'RBRACKET', 'COMMA', 'SEMICOLON', 'EOF']);
  });

  it('newline is a token', () => {
    expect(types('\n')).toEqual(['NEWLINE', 'EOF']);
  });

  it('bare-id: ASCII letters and numbers', () => {
    const result = lex('abc123');
    expect(result.tokens[0]?.type).toBe('ID');
    expect(result.tokens[0]?.value).toBe('abc123');
  });

  it('bare-id: underscore and hyphen allowed', () => {
    const result = lex('my_id-name');
    expect(result.tokens[0]?.value).toBe('my_id-name');
  });

  it('bare-id: Unicode letters allowed', () => {
    const result = lex('要件定義');
    expect(result.tokens[0]?.value).toBe('要件定義');
  });

  it('bare-id stops before >>', () => {
    expect(types('a>>b')).toEqual(['ID', 'ARROW_INPUT', 'ID', 'EOF']);
    expect(values('a>>b')).toEqual(['a', '>>', 'b', '']);
  });

  it('bare-id stops before ->', () => {
    expect(types('P->B')).toEqual(['ID', 'ARROW_OUTPUT', 'ID', 'EOF']);
  });

  it('quoted-id: basic string', () => {
    const result = lex('"hello world"');
    expect(result.tokens[0]?.value).toBe('hello world');
  });

  it('quoted-id: escape sequences', () => {
    const result = lex('"a\\"b\\\\c\\nd\\te"');
    expect(result.tokens[0]?.value).toBe('a"b\\c\nd\te');
  });

  it('quoted-id: # inside is not a comment', () => {
    const result = lex('"id#not-comment"');
    expect(result.tokens[0]?.value).toBe('id#not-comment');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('# starts a comment until EOL', () => {
    expect(types('A # comment\nB')).toEqual(['ID', 'NEWLINE', 'ID', 'EOF']);
    expect(values('A # comment\nB')).toEqual(['A', '\n', 'B', '']);
  });

  it('whitespace (space, tab) is skipped', () => {
    expect(types('A  \t B')).toEqual(['ID', 'ID', 'EOF']);
  });

  it('full chain: position tracking', () => {
    const result = lex('A  >> P');
    const [a, arrow, p] = result.tokens;
    expect(a?.start).toEqual({ line: 1, column: 1, offset: 0 });
    expect(a?.end).toEqual({ line: 1, column: 2, offset: 1 });
    expect(arrow?.start).toEqual({ line: 1, column: 4, offset: 3 });
    expect(p?.start).toEqual({ line: 1, column: 7, offset: 6 });
  });

  it('multiline: line tracking', () => {
    const result = lex('A\nB');
    const bToken = result.tokens.find(t => t.value === 'B');
    expect(bToken?.start.line).toBe(2);
    expect(bToken?.start.column).toBe(1);
  });

  it('unknown character: produces error diagnostic', () => {
    const result = lex('@');
    expect(result.diagnostics.some(d => d.severity === 'error')).toBe(true);
  });
});
