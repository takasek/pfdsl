import type { Token, TokenType, Position, Diagnostic } from './types/index.js';

export const ID_PATTERN = /[\p{L}\p{N}_][\p{L}\p{N}_-]*/u;

const BARE_ID_RE = /[\p{L}\p{N}]/u;

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  function currentPos(): Position {
    return { line, column, offset: pos };
  }

  function advance(count = 1): string {
    let result = '';
    for (let i = 0; i < count; i++) {
      if (pos >= source.length) break;
      const cp = source.codePointAt(pos)!;
      const charLen = cp > 0xFFFF ? 2 : 1;
      const ch = source.slice(pos, pos + charLen);
      result += ch;
      if (ch === '\n') { line++; column = 1; } else { column++; }
      pos += charLen;
    }
    return result;
  }

  function peek(offset = 0): string {
    let p = pos;
    for (let i = 0; i < offset; i++) {
      if (p >= source.length) return '';
      p += (source.codePointAt(p)! > 0xFFFF) ? 2 : 1;
    }
    if (p >= source.length) return '';
    const cp = source.codePointAt(p)!;
    return cp > 0xFFFF ? source.slice(p, p + 2) : source[p]!;
  }

  function makeToken(
    type: TokenType, value: string, raw: string,
    start: Position, end: Position,
  ): Token {
    return { type, value, raw, start, end };
  }

  while (pos < source.length) {
    const ch = peek();

    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue; }

    if (ch === '\n') {
      const start = currentPos();
      advance();
      tokens.push(makeToken('NEWLINE', '\n', '\n', start, currentPos()));
      continue;
    }

    if (ch === '#') {
      const start = currentPos();
      let raw = '';
      while (pos < source.length && peek() !== '\n') raw += advance();
      tokens.push(makeToken('COMMENT', raw, raw, start, currentPos()));
      continue;
    }

    // Operators (longest match: >>? before >>)
    if (ch === '>' && peek(1) === '>' && peek(2) === '?') {
      const start = currentPos(); advance(3);
      tokens.push(makeToken('ARROW_FEEDBACK', '>>?', '>>?', start, currentPos()));
      continue;
    }
    if (ch === '>' && peek(1) === '>') {
      const start = currentPos(); advance(2);
      tokens.push(makeToken('ARROW_INPUT', '>>', '>>', start, currentPos()));
      continue;
    }
    if (ch === '-' && peek(1) === '>') {
      const start = currentPos(); advance(2);
      tokens.push(makeToken('ARROW_OUTPUT', '->', '->', start, currentPos()));
      continue;
    }

    if (ch === '[') { const s = currentPos(); advance(); tokens.push(makeToken('LBRACKET', '[', '[', s, currentPos())); continue; }
    if (ch === ']') { const s = currentPos(); advance(); tokens.push(makeToken('RBRACKET', ']', ']', s, currentPos())); continue; }
    if (ch === ',') { const s = currentPos(); advance(); tokens.push(makeToken('COMMA', ',', ',', s, currentPos())); continue; }
    if (ch === ';') { const s = currentPos(); advance(); tokens.push(makeToken('SEMICOLON', ';', ';', s, currentPos())); continue; }

    if (ch === '"') {
      const start = currentPos();
      advance(); // consume opening "
      let value = '';
      let raw = '"';
      let closed = false;
      while (pos < source.length) {
        const c = peek();
        if (c === '"') { advance(); raw += '"'; closed = true; break; }
        if (c === '\n') break;  // unclosed
        if (c === '\\') {
          advance(); raw += '\\';
          const esc = peek();
          if      (esc === '"')  { value += '"';  raw += '"';  advance(); }
          else if (esc === '\\') { value += '\\'; raw += '\\'; advance(); }
          else if (esc === 'n')  { value += '\n'; raw += 'n';  advance(); }
          else if (esc === 't')  { value += '\t'; raw += 't';  advance(); }
          else { value += '\\' + esc; raw += esc; advance(); }
        } else {
          value += c; raw += c; advance();
        }
      }
      if (!closed) {
        diagnostics.push({ severity: 'error', code: 'L001', message: 'Unclosed quoted identifier',
          range: { start, end: currentPos() } });
      }
      tokens.push(makeToken('ID', value, raw, start, currentPos()));
      continue;
    }

    // (`-` followed by `>` already caught as ARROW_OUTPUT; `>>` already caught as ARROW_INPUT)
    if (isBareIdChar(ch)) {
      const start = currentPos();
      let value = '';
      while (pos < source.length) {
        const c = peek();
        // Stop before operators
        if (c === '>' && peek(1) === '>') break;
        if (c === '-' && peek(1) === '>') break;
        if (!isBareIdChar(c)) break;
        value += c;
        advance();
      }
      if (value.length > 0) {
        tokens.push(makeToken('ID', value, value, start, currentPos()));
        continue;
      }
    }

    const errStart = currentPos();
    const unknown = advance();
    diagnostics.push({
      severity: 'error', code: 'L002',
      message: `Unexpected character: ${JSON.stringify(unknown)}`,
      range: { start: errStart, end: currentPos() },
    });
  }

  tokens.push(makeToken('EOF', '', '', currentPos(), currentPos()));
  return { tokens, diagnostics };
}

function isBareIdChar(ch: string): boolean {
  if (ch === '_' || ch === '-') return true;
  return BARE_ID_RE.test(ch);
}
