# PFDSL Phase 1 — Core Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@pfdsl/core` — the TypeScript library that lexes, parses, normalizes, validates, sorts, and formats `.pfdsl` source text.

**Architecture:** Frontmatter is split from body first; body is lexed to tokens, parsed to AST, normalized to canonical EdgeSet, then validated and sorted. The formatter renders sorted EdgeSet as text. Each stage is a pure function that returns its result plus any diagnostics.

**Tech Stack:** TypeScript 5.4 strict, pnpm monorepo, vitest 1.x, tsup 8.x, `yaml` 2.x

---

## File Structure

```
pfdsl/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── packages/core/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    └── src/
        ├── types/
        │   ├── token.ts
        │   ├── ast.ts
        │   ├── edge.ts
        │   ├── graph.ts
        │   ├── diagnostic.ts
        │   ├── frontmatter.ts
        │   └── index.ts
        ├── frontmatter.ts       (loadFrontmatter)
        ├── frontmatter.test.ts
        ├── lexer.ts             (lex)
        ├── lexer.test.ts
        ├── parser.ts            (parse tokens → AST)
        ├── parser.test.ts
        ├── normalizer.ts        (AST + fm → EdgeSet)
        ├── normalizer.test.ts
        ├── graph.ts             (EdgeSet → Graph)
        ├── graph.test.ts
        ├── sorter.ts            (canonical sort)
        ├── sorter.test.ts
        ├── validator.ts         (constraint checks)
        ├── validator.test.ts
        ├── formatter.ts         (sorted edges → text)
        ├── formatter.test.ts
        ├── index.ts             (public API)
        └── index.test.ts        (integration)
```

---

## Task 0: Monorepo Scaffold

**Files:** Create root config + `packages/core` skeleton

- [ ] **Step 1: Create root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

`package.json` (root):
```json
{
  "name": "pfdsl",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 2: Create `packages/core` config files**

`packages/core/package.json`:
```json
{
  "name": "@pfdsl/core",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
  },
});
```

- [ ] **Step 3: Install dependencies**

```bash
cd /path/to/pfdsl && pnpm install
```
Expected: `packages/core/node_modules/` created, no errors.

- [ ] **Step 4: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo with @pfdsl/core package"
```

---

## Task 1: Shared Types

**Files:**
- Create: `packages/core/src/types/token.ts`
- Create: `packages/core/src/types/ast.ts`
- Create: `packages/core/src/types/edge.ts`
- Create: `packages/core/src/types/graph.ts`
- Create: `packages/core/src/types/diagnostic.ts`
- Create: `packages/core/src/types/frontmatter.ts`
- Create: `packages/core/src/types/index.ts`

- [ ] **Step 1: Write `packages/core/src/types/token.ts`**

```typescript
export type TokenType =
  | 'ARROW_FEEDBACK'  // >>?
  | 'ARROW_INPUT'     // >>
  | 'ARROW_OUTPUT'    // ->
  | 'LBRACKET'        // [
  | 'RBRACKET'        // ]
  | 'COMMA'           // ,
  | 'SEMICOLON'       // ;
  | 'NEWLINE'
  | 'ID'
  | 'EOF';

export interface Position {
  line: number;    // 1-based
  column: number;  // 1-based
  offset: number;  // 0-based byte offset
}

export interface Token {
  type: TokenType;
  value: string;   // normalized: for ID = unquoted+unescaped; others = raw
  raw: string;     // original source text
  start: Position;
  end: Position;
}
```

- [ ] **Step 2: Write `packages/core/src/types/ast.ts`**

```typescript
import type { Position } from './token.js';

export interface IdNode {
  type: 'id';
  value: string;
  raw: string;
  start: Position;
  end: Position;
}

export interface ArtifactExpr {
  type: 'artifact-expr';
  ids: IdNode[];
  start: Position;
  end: Position;
}

export interface ChainSegment {
  op: '>>' | '>>?';
  process: IdNode;
  output: ArtifactExpr;
}

export interface ChainStatement {
  type: 'chain';
  head: ArtifactExpr;
  segments: ChainSegment[];
  start: Position;
  end: Position;
}

export interface InputEdgeStatement {
  type: 'input-edge';
  artifact: ArtifactExpr;
  process: IdNode;
  start: Position;
  end: Position;
}

export interface FeedbackEdgeStatement {
  type: 'feedback-edge';
  artifact: ArtifactExpr;
  process: IdNode;
  start: Position;
  end: Position;
}

export interface OutputEdgeStatement {
  type: 'output-edge';
  process: IdNode;
  artifact: ArtifactExpr;
  start: Position;
  end: Position;
}

export type Statement =
  | ChainStatement
  | InputEdgeStatement
  | FeedbackEdgeStatement
  | OutputEdgeStatement;

export interface Document {
  type: 'document';
  statements: Statement[];
}
```

- [ ] **Step 3: Write `packages/core/src/types/edge.ts`**

```typescript
export type NormalizedEdge =
  | { kind: 'input';    artifact: string; process: string }
  | { kind: 'feedback'; artifact: string; process: string }
  | { kind: 'output';   process: string;  artifact: string };

export interface EdgeSet {
  edges: NormalizedEdge[];
}
```

- [ ] **Step 4: Write `packages/core/src/types/graph.ts`**

```typescript
export type NodeKind = 'artifact' | 'process';

export interface Graph {
  nodes: Map<string, NodeKind>;
  primaryEdges: Array<{ from: string; to: string; kind: 'input' | 'output' }>;
  feedbackEdges: Array<{ artifact: string; process: string }>;
}
```

- [ ] **Step 5: Write `packages/core/src/types/diagnostic.ts`**

```typescript
import type { Position } from './token.js';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Range {
  start: Position;
  end: Position;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  range: Range;
}
```

- [ ] **Step 6: Write `packages/core/src/types/frontmatter.ts`**

```typescript
import type { Diagnostic } from './diagnostic.js';

export interface ArtifactMeta {
  title?: string;
  owner?: string;
  parts?: string[];
  [key: string]: unknown;
}

export interface ProcessMeta {
  title?: string;
  owner?: string;
  [key: string]: unknown;
}

export interface Frontmatter {
  title?: string;
  version?: string | number;
  dsl_version?: string;
  description?: string;
  tags?: string[];
  layout?: {
    direction?: 'LR' | 'RL' | 'TB' | 'BT';
    [key: string]: unknown;
  };
  artifact?: Record<string, ArtifactMeta>;
  process?: Record<string, ProcessMeta>;
  [key: string]: unknown;
}

export interface LoadResult {
  frontmatter: Frontmatter | null;
  body: string;
  bodyStartLine: number;  // 1-based line where body starts
  diagnostics: Diagnostic[];
}
```

- [ ] **Step 7: Write `packages/core/src/types/index.ts`**

```typescript
export type { TokenType, Position, Token } from './token.js';
export type {
  IdNode, ArtifactExpr, ChainSegment,
  ChainStatement, InputEdgeStatement, FeedbackEdgeStatement, OutputEdgeStatement,
  Statement, Document,
} from './ast.js';
export type { NormalizedEdge, EdgeSet } from './edge.js';
export type { NodeKind, Graph } from './graph.js';
export type { DiagnosticSeverity, Range, Diagnostic } from './diagnostic.js';
export type { ArtifactMeta, ProcessMeta, Frontmatter, LoadResult } from './frontmatter.js';
```

- [ ] **Step 8: Typecheck**

```bash
cd packages/core && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/types/
git commit -m "feat(core): add shared type definitions"
```

---

## Task 2: Frontmatter Loader

**Files:**
- Create: `packages/core/src/frontmatter.ts`
- Create: `packages/core/src/frontmatter.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/frontmatter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { loadFrontmatter } from './frontmatter.js';

describe('loadFrontmatter', () => {
  it('no frontmatter: returns body as-is, bodyStartLine=1', () => {
    const result = loadFrontmatter('A >> P -> B\n');
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('A >> P -> B\n');
    expect(result.bodyStartLine).toBe(1);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('valid frontmatter: parses YAML and extracts body', () => {
    const src = '---\ntitle: Test\n---\nA >> P\n';
    const result = loadFrontmatter(src);
    expect(result.frontmatter).toEqual({ title: 'Test' });
    expect(result.body).toBe('A >> P\n');
    expect(result.bodyStartLine).toBe(4);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('empty frontmatter block: returns null frontmatter', () => {
    const src = '---\n---\nA >> P\n';
    const result = loadFrontmatter(src);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('A >> P\n');
    expect(result.bodyStartLine).toBe(3);
  });

  it('invalid YAML: returns error diagnostic and null frontmatter', () => {
    const src = '---\n: bad: yaml\n---\nbody\n';
    const result = loadFrontmatter(src);
    expect(result.frontmatter).toBeNull();
    expect(result.diagnostics.some(d => d.severity === 'error' && d.code === 'FM002')).toBe(true);
  });

  it('unclosed frontmatter: returns error and treats whole source as body', () => {
    const src = '---\ntitle: Test\n';
    const result = loadFrontmatter(src);
    expect(result.frontmatter).toBeNull();
    expect(result.diagnostics.some(d => d.code === 'FM001')).toBe(true);
  });

  it('bodyStartLine accounts for frontmatter line count', () => {
    const src = '---\na: 1\nb: 2\n---\nbody';
    const result = loadFrontmatter(src);
    expect(result.bodyStartLine).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test frontmatter
```
Expected: `Cannot find module './frontmatter.js'`

- [ ] **Step 3: Write implementation**

`packages/core/src/frontmatter.ts`:
```typescript
import { parse as parseYaml } from 'yaml';
import type { Frontmatter, LoadResult } from './types/index.js';
import type { Diagnostic } from './types/index.js';

export function loadFrontmatter(source: string): LoadResult {
  if (!source.startsWith('---')) {
    return { frontmatter: null, body: source, bodyStartLine: 1, diagnostics: [] };
  }

  const lines = source.split('\n');
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trimEnd() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    const diag: Diagnostic = {
      severity: 'error',
      code: 'FM001',
      message: 'Unclosed front matter: missing closing ---',
      range: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 4, offset: 3 } },
    };
    return { frontmatter: null, body: source, bodyStartLine: 1, diagnostics: [diag] };
  }

  const yamlText = lines.slice(1, closingIndex).join('\n');
  const body = lines.slice(closingIndex + 1).join('\n');
  const bodyStartLine = closingIndex + 2;

  const diagnostics: Diagnostic[] = [];
  let frontmatter: Frontmatter | null = null;

  try {
    const parsed = parseYaml(yamlText);
    if (parsed != null && typeof parsed === 'object') {
      frontmatter = parsed as Frontmatter;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push({
      severity: 'error',
      code: 'FM002',
      message: `Invalid YAML in front matter: ${msg}`,
      range: { start: { line: 2, column: 1, offset: 4 }, end: { line: 2, column: 1, offset: 4 } },
    });
  }

  return { frontmatter, body, bodyStartLine, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test frontmatter
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/frontmatter.ts packages/core/src/frontmatter.test.ts
git commit -m "feat(core): implement frontmatter loader"
```

---

## Task 3: Lexer

**Files:**
- Create: `packages/core/src/lexer.ts`
- Create: `packages/core/src/lexer.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/lexer.test.ts`:
```typescript
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
    const result = lex('A >> P');
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test lexer
```
Expected: `Cannot find module './lexer.js'`

- [ ] **Step 3: Write implementation**

`packages/core/src/lexer.ts`:
```typescript
import type { Token, TokenType, Position } from './types/index.js';
import type { Diagnostic } from './types/index.js';

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
      const ch = source[pos]!;
      result += ch;
      if (ch === '\n') { line++; column = 1; } else { column++; }
      pos++;
    }
    return result;
  }

  function peek(offset = 0): string {
    return source[pos + offset] ?? '';
  }

  function makeToken(
    type: TokenType, value: string, raw: string,
    start: Position, end: Position,
  ): Token {
    return { type, value, raw, start, end };
  }

  while (pos < source.length) {
    const ch = peek();

    // Skip horizontal whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue; }

    // Newline token
    if (ch === '\n') {
      const start = currentPos();
      advance();
      tokens.push(makeToken('NEWLINE', '\n', '\n', start, currentPos()));
      continue;
    }

    // Comment: # to EOL (only outside quoted strings)
    if (ch === '#') {
      while (pos < source.length && peek() !== '\n') advance();
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

    // Single-char tokens
    if (ch === '[') { const s = currentPos(); advance(); tokens.push(makeToken('LBRACKET', '[', '[', s, currentPos())); continue; }
    if (ch === ']') { const s = currentPos(); advance(); tokens.push(makeToken('RBRACKET', ']', ']', s, currentPos())); continue; }
    if (ch === ',') { const s = currentPos(); advance(); tokens.push(makeToken('COMMA', ',', ',', s, currentPos())); continue; }
    if (ch === ';') { const s = currentPos(); advance(); tokens.push(makeToken('SEMICOLON', ';', ';', s, currentPos())); continue; }

    // Quoted ID
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

    // Bare ID: Unicode letters/numbers + _ -
    // (- followed by > is already caught above as ARROW_OUTPUT; > followed by > is ARROW_INPUT)
    if (isBareIdStart(ch)) {
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

    // Unknown character
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

function isBareIdStart(ch: string): boolean {
  return isBareIdChar(ch);
}

function isBareIdChar(ch: string): boolean {
  if (ch === '_' || ch === '-') return true;
  return /[\p{L}\p{N}]/u.test(ch);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test lexer
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lexer.ts packages/core/src/lexer.test.ts
git commit -m "feat(core): implement lexer with Unicode support and position tracking"
```

---

## Task 4: Parser

**Files:**
- Create: `packages/core/src/parser.ts`
- Create: `packages/core/src/parser.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/parser.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test parser
```
Expected: `Cannot find module './parser.js'`

- [ ] **Step 3: Write implementation**

`packages/core/src/parser.ts`:
```typescript
import type { Token } from './types/index.js';
import type {
  Document, Statement, ChainStatement, ChainSegment,
  InputEdgeStatement, FeedbackEdgeStatement, OutputEdgeStatement,
  ArtifactExpr, IdNode,
} from './types/index.js';
import type { Diagnostic } from './types/index.js';

export interface ParseResult {
  document: Document;
  diagnostics: Diagnostic[];
}

export function parseTokens(tokens: Token[]): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let pos = 0;

  function peek(offset = 0): Token {
    const idx = pos + offset;
    return tokens[Math.min(idx, tokens.length - 1)]!;
  }

  function advance(): Token {
    const t = tokens[pos]!;
    if (pos < tokens.length - 1) pos++;
    return t;
  }

  function skipSeparators(): void {
    while (peek().type === 'NEWLINE' || peek().type === 'SEMICOLON') advance();
  }

  function parseId(): IdNode | null {
    const t = peek();
    if (t.type !== 'ID') return null;
    advance();
    return { type: 'id', value: t.value, raw: t.raw, start: t.start, end: t.end };
  }

  function parseArtifactExpr(): ArtifactExpr | null {
    const t = peek();

    if (t.type === 'LBRACKET') {
      const start = t.start;
      advance();
      skipSeparators();
      const ids: IdNode[] = [];
      const first = parseId();
      if (!first) {
        diagnostics.push({ severity: 'error', code: 'P002',
          message: 'Expected identifier in artifact set',
          range: { start: peek().start, end: peek().end } });
        while (peek().type !== 'RBRACKET' && peek().type !== 'EOF') advance();
        const end = peek().end;
        if (peek().type === 'RBRACKET') advance();
        return { type: 'artifact-expr', ids: [], start, end };
      }
      ids.push(first);
      while (peek().type === 'COMMA') {
        advance();
        skipSeparators();
        const id = parseId();
        if (!id) {
          diagnostics.push({ severity: 'error', code: 'P003',
            message: 'Expected identifier after comma in set',
            range: { start: peek().start, end: peek().end } });
          break;
        }
        ids.push(id);
      }
      skipSeparators();
      const rb = peek();
      if (rb.type === 'RBRACKET') advance();
      else diagnostics.push({ severity: 'error', code: 'P011',
        message: 'Expected ] to close artifact set',
        range: { start: rb.start, end: rb.end } });
      const end = peek();
      return { type: 'artifact-expr', ids, start, end: { ...end.start } };
    }

    const id = parseId();
    if (!id) return null;
    return { type: 'artifact-expr', ids: [id], start: id.start, end: id.end };
  }

  function skipToStatementEnd(): void {
    while (
      peek().type !== 'NEWLINE' &&
      peek().type !== 'SEMICOLON' &&
      peek().type !== 'EOF'
    ) advance();
  }

  function parseStatement(): Statement | null {
    const t = peek();

    // Output edge: ID '->' artifact
    if (t.type === 'ID' && peek(1).type === 'ARROW_OUTPUT') {
      const processId = parseId()!;
      advance(); // consume ->
      const artifact = parseArtifactExpr();
      if (!artifact) {
        diagnostics.push({ severity: 'error', code: 'P004',
          message: 'Expected artifact expression after ->',
          range: { start: peek().start, end: peek().end } });
        return null;
      }
      return { type: 'output-edge', process: processId, artifact,
        start: processId.start, end: artifact.end } as OutputEdgeStatement;
    }

    // Parse artifact-expr (single ID or [id, ...])
    const head = parseArtifactExpr();
    if (!head) {
      diagnostics.push({ severity: 'error', code: 'P001',
        message: `Unexpected token: ${peek().type} (${peek().raw})`,
        range: { start: peek().start, end: peek().end } });
      return null;
    }

    const opToken = peek();
    if (opToken.type !== 'ARROW_INPUT' && opToken.type !== 'ARROW_FEEDBACK') {
      diagnostics.push({ severity: 'error', code: 'P005',
        message: `Expected >> or >>? after artifact, got ${opToken.type}`,
        range: { start: opToken.start, end: opToken.end } });
      return null;
    }

    const op: '>>' | '>>?' = opToken.type === 'ARROW_INPUT' ? '>>' : '>>?';
    advance();

    const processId = parseId();
    if (!processId) {
      diagnostics.push({ severity: 'error', code: 'P006',
        message: 'Expected process identifier',
        range: { start: peek().start, end: peek().end } });
      return null;
    }

    // Not followed by ->: simple edge
    if (peek().type !== 'ARROW_OUTPUT') {
      if (op === '>>') {
        return { type: 'input-edge', artifact: head, process: processId,
          start: head.start, end: processId.end } as InputEdgeStatement;
      } else {
        return { type: 'feedback-edge', artifact: head, process: processId,
          start: head.start, end: processId.end } as FeedbackEdgeStatement;
      }
    }

    // Chain: artifact op process -> output (op process -> output)*
    advance(); // consume ->
    const firstOutput = parseArtifactExpr();
    if (!firstOutput) {
      diagnostics.push({ severity: 'error', code: 'P007',
        message: 'Expected artifact expression after -> in chain',
        range: { start: peek().start, end: peek().end } });
      return null;
    }

    const segments: ChainSegment[] = [{ op, process: processId, output: firstOutput }];

    while (peek().type === 'ARROW_INPUT' || peek().type === 'ARROW_FEEDBACK') {
      const segOp: '>>' | '>>?' = peek().type === 'ARROW_INPUT' ? '>>' : '>>?';
      advance();
      const segProcess = parseId();
      if (!segProcess) {
        diagnostics.push({ severity: 'error', code: 'P008',
          message: 'Expected process identifier in chain continuation',
          range: { start: peek().start, end: peek().end } });
        break;
      }
      if (peek().type !== 'ARROW_OUTPUT') {
        diagnostics.push({ severity: 'error', code: 'P009',
          message: 'Expected -> in chain continuation',
          range: { start: peek().start, end: peek().end } });
        break;
      }
      advance();
      const segOutput = parseArtifactExpr();
      if (!segOutput) {
        diagnostics.push({ severity: 'error', code: 'P010',
          message: 'Expected artifact expression in chain continuation',
          range: { start: peek().start, end: peek().end } });
        break;
      }
      segments.push({ op: segOp, process: segProcess, output: segOutput });
    }

    const last = segments[segments.length - 1]!;
    return { type: 'chain', head, segments,
      start: head.start, end: last.output.end } as ChainStatement;
  }

  const statements: Statement[] = [];
  skipSeparators();

  while (peek().type !== 'EOF') {
    const stmt = parseStatement();
    if (stmt) {
      statements.push(stmt);
    } else {
      skipToStatementEnd();
    }
    skipSeparators();
  }

  return { document: { type: 'document', statements }, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test parser
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parser.ts packages/core/src/parser.test.ts
git commit -m "feat(core): implement recursive descent parser"
```

---

## Task 5: Normalizer

**Files:**
- Create: `packages/core/src/normalizer.ts`
- Create: `packages/core/src/normalizer.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/normalizer.test.ts`:
```typescript
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
    // A used as both artifact (left of >>) and process (right of >>)
    const { tokens } = lex('A >> P\nB >> A');
    const { document } = parseTokens(tokens);
    const { diagnostics } = normalize(document, null);
    expect(diagnostics.some(d => d.severity === 'error' && d.code === 'N002')).toBe(true);
  });

  it('front matter artifact declaration takes priority', () => {
    const fm = { artifact: { P: { title: 'Override' } } };
    // Even though P appears as process in edges, FM says it's artifact
    const { diagnostics } = (() => {
      const { tokens } = lex('A >> P');
      const { document } = parseTokens(tokens);
      return normalize(document, fm as any);
    })();
    // P is declared as artifact in FM but used as process in body → contradiction
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test normalizer
```
Expected: `Cannot find module './normalizer.js'`

- [ ] **Step 3: Write implementation**

`packages/core/src/normalizer.ts`:
```typescript
import type { Document, Statement, ArtifactExpr } from './types/index.js';
import type { EdgeSet, NormalizedEdge } from './types/index.js';
import type { Frontmatter } from './types/index.js';
import type { Diagnostic, Position } from './types/index.js';

export interface NormalizeResult {
  edges: EdgeSet;
  nodeKinds: Map<string, 'artifact' | 'process'>;
  diagnostics: Diagnostic[];
}

function zeroPos(): Position {
  return { line: 1, column: 1, offset: 0 };
}

function zeroRange() {
  const p = zeroPos();
  return { start: p, end: p };
}

export function normalize(doc: Document, fm: Frontmatter | null): NormalizeResult {
  const diagnostics: Diagnostic[] = [];
  const rawEdges: NormalizedEdge[] = [];
  const nodeKinds = new Map<string, 'artifact' | 'process'>();

  // Pre-populate from front matter (takes priority)
  for (const id of Object.keys(fm?.artifact ?? {})) {
    nodeKinds.set(id, 'artifact');
  }
  for (const id of Object.keys(fm?.process ?? {})) {
    if (nodeKinds.has(id)) {
      diagnostics.push({ severity: 'error', code: 'N001',
        message: `'${id}' declared as both artifact and process in front matter`,
        range: zeroRange() });
    } else {
      nodeKinds.set(id, 'process');
    }
  }

  function inferKind(id: string, kind: 'artifact' | 'process'): void {
    const existing = nodeKinds.get(id);
    if (existing === undefined) { nodeKinds.set(id, kind); return; }
    if (existing !== kind) {
      diagnostics.push({ severity: 'error', code: 'N002',
        message: `'${id}' used as both artifact and process`,
        range: zeroRange() });
    }
  }

  function addEdge(edge: NormalizedEdge): void {
    const dup = rawEdges.some(e => {
      if (e.kind !== edge.kind) return false;
      if (edge.kind === 'input'    && e.kind === 'input')    return e.artifact === edge.artifact && e.process === edge.process;
      if (edge.kind === 'feedback' && e.kind === 'feedback') return e.artifact === edge.artifact && e.process === edge.process;
      if (edge.kind === 'output'   && e.kind === 'output')   return e.process  === edge.process  && e.artifact === edge.artifact;
      return false;
    });
    if (dup) {
      diagnostics.push({ severity: 'warning', code: 'N003',
        message: 'Duplicate edge', range: zeroRange() });
      return;
    }
    rawEdges.push(edge);
  }

  function ids(expr: ArtifactExpr): string[] {
    return expr.ids.map(i => i.value);
  }

  function processStmt(stmt: Statement): void {
    switch (stmt.type) {
      case 'chain': {
        let currentArtifacts = ids(stmt.head);
        for (const seg of stmt.segments) {
          const proc = seg.process.value;
          for (const a of currentArtifacts) {
            inferKind(a, 'artifact');
            inferKind(proc, 'process');
            addEdge(seg.op === '>>'
              ? { kind: 'input',    artifact: a, process: proc }
              : { kind: 'feedback', artifact: a, process: proc });
          }
          const outArtifacts = ids(seg.output);
          for (const a of outArtifacts) {
            inferKind(a, 'artifact');
            inferKind(proc, 'process');
            addEdge({ kind: 'output', process: proc, artifact: a });
          }
          currentArtifacts = outArtifacts;
        }
        break;
      }
      case 'input-edge': {
        const proc = stmt.process.value;
        for (const a of ids(stmt.artifact)) {
          inferKind(a, 'artifact');
          inferKind(proc, 'process');
          addEdge({ kind: 'input', artifact: a, process: proc });
        }
        break;
      }
      case 'feedback-edge': {
        const proc = stmt.process.value;
        for (const a of ids(stmt.artifact)) {
          inferKind(a, 'artifact');
          inferKind(proc, 'process');
          addEdge({ kind: 'feedback', artifact: a, process: proc });
        }
        break;
      }
      case 'output-edge': {
        const proc = stmt.process.value;
        for (const a of ids(stmt.artifact)) {
          inferKind(a, 'artifact');
          inferKind(proc, 'process');
          addEdge({ kind: 'output', process: proc, artifact: a });
        }
        break;
      }
    }
  }

  for (const stmt of doc.statements) processStmt(stmt);

  return { edges: { edges: rawEdges }, nodeKinds, diagnostics };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test normalizer
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/normalizer.ts packages/core/src/normalizer.test.ts
git commit -m "feat(core): implement normalizer (AST → EdgeSet with type inference)"
```

---

## Task 6: Graph Builder

**Files:**
- Create: `packages/core/src/graph.ts`
- Create: `packages/core/src/graph.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/graph.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test graph
```
Expected: `Cannot find module './graph.js'`

- [ ] **Step 3: Write implementation**

`packages/core/src/graph.ts`:
```typescript
import type { EdgeSet, Graph, NodeKind } from './types/index.js';

export function buildGraph(edges: EdgeSet, nodeKinds: Map<string, NodeKind>): Graph {
  const nodes = new Map<string, NodeKind>(nodeKinds);

  for (const edge of edges.edges) {
    if (edge.kind === 'input' || edge.kind === 'feedback') {
      if (!nodes.has(edge.artifact)) nodes.set(edge.artifact, 'artifact');
      if (!nodes.has(edge.process))  nodes.set(edge.process,  'process');
    } else {
      if (!nodes.has(edge.process))  nodes.set(edge.process,  'process');
      if (!nodes.has(edge.artifact)) nodes.set(edge.artifact, 'artifact');
    }
  }

  const primaryEdges = edges.edges
    .filter(e => e.kind === 'input' || e.kind === 'output')
    .map(e => e.kind === 'input'
      ? { from: e.artifact, to: e.process,  kind: 'input'  as const }
      : { from: e.process,  to: e.artifact, kind: 'output' as const });

  const feedbackEdges = edges.edges
    .filter(e => e.kind === 'feedback')
    .map(e => ({ artifact: e.artifact, process: e.process }));

  return { nodes, primaryEdges, feedbackEdges };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test graph
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/graph.ts packages/core/src/graph.test.ts
git commit -m "feat(core): implement graph builder (EdgeSet → primary/feedback graph)"
```

---

## Task 7: Canonical Sorter

**Files:**
- Create: `packages/core/src/sorter.ts`
- Create: `packages/core/src/sorter.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/sorter.test.ts`:
```typescript
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
    // input(A>>P), output(P->B), input(B>>Q), output(Q->C)
    expect(kinds).toEqual(['input', 'output', 'input', 'output']);
  });

  it('within same rank: >> before ->', () => {
    // P has input A and output B — both at rank 0 for input, rank 1 for output
    // Single node no ambiguity, but test kind ordering
    const result = sorted('[a, b] >> P -> [x, y]');
    const inputs = result.filter(e => e.kind === 'input');
    const outputs = result.filter(e => e.kind === 'output');
    expect(inputs.length).toBe(2);
    expect(outputs.length).toBe(2);
    // All inputs before outputs
    const firstOutputIdx = result.findIndex(e => e.kind === 'output');
    const lastInputIdx = result.map(e => e.kind).lastIndexOf('input');
    expect(lastInputIdx).toBeLessThan(firstOutputIdx);
  });

  it('lexicographic ordering within same rank and type', () => {
    const result = sorted('[b, a] >> P -> B');
    const inputs = result.filter(e => e.kind === 'input');
    // a comes before b lexicographically
    expect(inputs[0]).toEqual({ kind: 'input', artifact: 'a', process: 'P' });
    expect(inputs[1]).toEqual({ kind: 'input', artifact: 'b', process: 'P' });
  });

  it('feedback edges placed by process rank', () => {
    // req >> design -> spec; spec >>? design (feedback at rank of design=1)
    const result = sorted('req >> design -> spec\nspec >>? design');
    // feedback (spec >>? design) placed at rank 1 (design rank), after input (rank 0) but...
    // rank 0: req >> design (input)
    // rank 1: feedback (kind=1) before output (kind=2)
    const fbIdx = result.findIndex(e => e.kind === 'feedback');
    const outIdx = result.findIndex(e => e.kind === 'output');
    expect(fbIdx).toBeGreaterThan(-1);
    expect(fbIdx).toBeLessThan(outIdx);
  });

  it('separate connected components: smaller min-ID component first', () => {
    // Component 1: a >> P1 -> b (min ID = a)
    // Component 2: x >> P2 -> y (min ID = x)
    // a < x → component 1 first
    const result = sorted('x >> P2 -> y\na >> P1 -> b');
    expect(result[0]).toMatchObject({ artifact: 'a' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test sorter
```
Expected: `Cannot find module './sorter.js'`

- [ ] **Step 3: Write implementation**

`packages/core/src/sorter.ts`:
```typescript
import type { EdgeSet, NormalizedEdge, Graph } from './types/index.js';

export function sortEdges(edges: EdgeSet, graph: Graph): NormalizedEdge[] {
  // Union-Find for connected components (primary graph, undirected)
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  }

  function union(x: string, y: string): void {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  }

  for (const e of graph.primaryEdges) union(e.from, e.to);

  // Min node ID per component
  const componentMin = new Map<string, string>();
  for (const nodeId of graph.nodes.keys()) {
    const root = find(nodeId);
    const cur = componentMin.get(root);
    if (cur === undefined || nodeId < cur) componentMin.set(root, nodeId);
  }

  function componentKey(nodeId: string): string {
    return componentMin.get(find(nodeId)) ?? nodeId;
  }

  // Rank: iterative BFS until stable
  // Source artifacts (no incoming primary edge) = rank 0
  const hasIncoming = new Set(graph.primaryEdges.map(e => e.to));
  const ranks = new Map<string, number>();

  for (const [id, kind] of graph.nodes) {
    if (kind === 'artifact' && !hasIncoming.has(id)) ranks.set(id, 0);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const e of graph.primaryEdges) {
      if (e.kind === 'input') {
        const r = (ranks.get(e.from) ?? 0) + 1;
        if (r > (ranks.get(e.to) ?? -1)) { ranks.set(e.to, r); changed = true; }
      } else {
        const r = (ranks.get(e.from) ?? 0) + 1;
        if (r > (ranks.get(e.to) ?? -1)) { ranks.set(e.to, r); changed = true; }
      }
    }
  }

  // Any unranked node → 0
  for (const id of graph.nodes.keys()) {
    if (!ranks.has(id)) ranks.set(id, 0);
  }

  function edgeRank(e: NormalizedEdge): number {
    if (e.kind === 'input')    return ranks.get(e.artifact) ?? 0;
    if (e.kind === 'feedback') return ranks.get(e.process)  ?? 0;
    /* output */               return ranks.get(e.process)  ?? 0;
  }

  function edgeKindOrder(e: NormalizedEdge): number {
    if (e.kind === 'input')    return 0;
    if (e.kind === 'feedback') return 1;
    /* output */               return 2;
  }

  function edgeComponentKey(e: NormalizedEdge): string {
    const ref = e.kind === 'output' ? e.process : e.artifact;
    return componentKey(ref);
  }

  function edgeLexKey(e: NormalizedEdge): string {
    if (e.kind === 'input')    return `${e.artifact}\0${e.process}`;
    if (e.kind === 'feedback') return `${e.artifact}\0${e.process}`;
    return `${e.process}\0${e.artifact}`;
  }

  return [...edges.edges].sort((a, b) => {
    const ck = edgeComponentKey(a).localeCompare(edgeComponentKey(b));
    if (ck !== 0) return ck;
    const rk = edgeRank(a) - edgeRank(b);
    if (rk !== 0) return rk;
    const kk = edgeKindOrder(a) - edgeKindOrder(b);
    if (kk !== 0) return kk;
    return edgeLexKey(a).localeCompare(edgeLexKey(b));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test sorter
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sorter.ts packages/core/src/sorter.test.ts
git commit -m "feat(core): implement canonical sorter (component/rank/kind/lex ordering)"
```

---

## Task 8: Validator

**Files:**
- Create: `packages/core/src/validator.ts`
- Create: `packages/core/src/validator.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/validator.test.ts`:
```typescript
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
    // P has output but no input registered — we need to manually create this case
    // Simplest: output edge without matching input
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test validator
```
Expected: `Cannot find module './validator.js'`

- [ ] **Step 3: Write implementation**

`packages/core/src/validator.ts`:
```typescript
import type { EdgeSet, Graph } from './types/index.js';
import type { Frontmatter } from './types/index.js';
import type { Diagnostic, Position } from './types/index.js';

function zeroPos(): Position { return { line: 1, column: 1, offset: 0 }; }
function zeroRange() { const p = zeroPos(); return { start: p, end: p }; }

export function validate(edges: EdgeSet, graph: Graph, fm: Frontmatter | null): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // V001: single-source constraint (Primary Graph)
  const artifactGenerators = new Map<string, string[]>();
  for (const e of edges.edges) {
    if (e.kind === 'output') {
      const gens = artifactGenerators.get(e.artifact) ?? [];
      gens.push(e.process);
      artifactGenerators.set(e.artifact, gens);
    }
  }
  for (const [artifact, processes] of artifactGenerators) {
    if (processes.length > 1) {
      diagnostics.push({ severity: 'error', code: 'V001',
        message: `'${artifact}' generated by multiple processes: ${processes.join(', ')}`,
        range: zeroRange() });
    }
  }

  // V002 / V003: process completeness
  const processInputCount  = new Map<string, number>();
  const processOutputCount = new Map<string, number>();
  for (const [id, kind] of graph.nodes) {
    if (kind === 'process') {
      processInputCount.set(id, 0);
      processOutputCount.set(id, 0);
    }
  }
  for (const e of edges.edges) {
    if (e.kind === 'input' || e.kind === 'feedback') {
      processInputCount.set(e.process, (processInputCount.get(e.process) ?? 0) + 1);
    } else {
      processOutputCount.set(e.process, (processOutputCount.get(e.process) ?? 0) + 1);
    }
  }
  for (const [id, count] of processInputCount) {
    if (count === 0) diagnostics.push({ severity: 'error', code: 'V002',
      message: `Process '${id}' has no inputs`, range: zeroRange() });
  }
  for (const [id, count] of processOutputCount) {
    if (count === 0) diagnostics.push({ severity: 'error', code: 'V003',
      message: `Process '${id}' has no outputs`, range: zeroRange() });
  }

  // V004 / V005 / V006: parts constraints
  const artifactMeta = fm?.artifact ?? {};
  for (const [artifactId, meta] of Object.entries(artifactMeta)) {
    for (const partId of meta.parts ?? []) {
      if (graph.nodes.get(partId) === 'process') {
        diagnostics.push({ severity: 'error', code: 'V004',
          message: `Parts member '${partId}' of '${artifactId}' is a process`,
          range: zeroRange() });
      }
      if (partId === artifactId) {
        diagnostics.push({ severity: 'error', code: 'V005',
          message: `'${artifactId}' cannot include itself in parts`,
          range: zeroRange() });
      }
    }
  }

  // Cycle detection in parts
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function detectCycle(id: string, path: string[]): void {
    if (inStack.has(id)) {
      diagnostics.push({ severity: 'error', code: 'V006',
        message: `Cycle in parts: ${[...path, id].join(' → ')}`,
        range: zeroRange() });
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    inStack.add(id);
    for (const part of artifactMeta[id]?.parts ?? []) {
      detectCycle(part, [...path, id]);
    }
    inStack.delete(id);
  }

  for (const id of Object.keys(artifactMeta)) detectCycle(id, []);

  return diagnostics;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test validator
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/validator.ts packages/core/src/validator.test.ts
git commit -m "feat(core): implement validator (single-source, completeness, parts constraints)"
```

---

## Task 9: Formatter

**Files:**
- Create: `packages/core/src/formatter.ts`
- Create: `packages/core/src/formatter.test.ts`

Design decision: Phase 1 formatter outputs individual canonical edges in sorted order, one per line, with trailing newline. No chain reconstruction, no comment preservation.

- [ ] **Step 1: Write failing tests**

`packages/core/src/formatter.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test formatter
```
Expected: `Cannot find module './formatter.js'`

- [ ] **Step 3: Write implementation**

`packages/core/src/formatter.ts`:
```typescript
import type { NormalizedEdge } from './types/index.js';

export function formatEdges(sortedEdges: NormalizedEdge[]): string {
  if (sortedEdges.length === 0) return '';
  return sortedEdges.map(e => {
    if (e.kind === 'input')    return `${e.artifact} >> ${e.process}`;
    if (e.kind === 'feedback') return `${e.artifact} >>? ${e.process}`;
    return `${e.process} -> ${e.artifact}`;
  }).join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test formatter
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/formatter.ts packages/core/src/formatter.test.ts
git commit -m "feat(core): implement formatter (canonical edge list to text)"
```

---

## Task 10: Public API + Integration

**Files:**
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write failing integration test**

`packages/core/src/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, normalizeDocument, buildGraph, validateGraph, sortEdges, format } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(__dirname, '../../../docs/pfdsl_implementation_flow.pfdsl');
const sampleSource = readFileSync(samplePath, 'utf-8');

describe('public API', () => {
  it('parse: parses the sample .pfdsl file without syntax errors', () => {
    const result = parse(sampleSource);
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.document.statements.length).toBeGreaterThan(0);
    expect(result.frontmatter).not.toBeNull();
  });

  it('normalizeDocument: produces edges without type errors', () => {
    const { document, frontmatter } = parse(sampleSource);
    const { edges, diagnostics } = normalizeDocument(document, frontmatter);
    const errors = diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(edges.edges.length).toBeGreaterThan(0);
  });

  it('validateGraph: sample file passes validation', () => {
    const { document, frontmatter } = parse(sampleSource);
    const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
    const graph = buildGraph(edges, nodeKinds);
    const diags = validateGraph(edges, graph, frontmatter);
    const errors = diags.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('format: produces non-empty output for sample file', () => {
    const { output, diagnostics } = format(sampleSource);
    const errors = diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(output.length).toBeGreaterThan(0);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('format is idempotent (format of format = format)', () => {
    const { output: first } = format(sampleSource);
    const { output: second } = format(first);
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test index
```
Expected: `Cannot find module './index.js'`

- [ ] **Step 3: Write public API**

`packages/core/src/index.ts`:
```typescript
import { loadFrontmatter } from './frontmatter.js';
import { lex } from './lexer.js';
import { parseTokens } from './parser.js';
import { normalize } from './normalizer.js';
import { buildGraph as buildGraphInternal } from './graph.js';
import { sortEdges } from './sorter.js';
import { validate } from './validator.js';
import { formatEdges } from './formatter.js';

export type { TokenType, Position, Token } from './types/index.js';
export type {
  IdNode, ArtifactExpr, ChainSegment,
  ChainStatement, InputEdgeStatement, FeedbackEdgeStatement, OutputEdgeStatement,
  Statement, Document,
} from './types/index.js';
export type { NormalizedEdge, EdgeSet } from './types/index.js';
export type { NodeKind, Graph } from './types/index.js';
export type { DiagnosticSeverity, Range, Diagnostic } from './types/index.js';
export type { ArtifactMeta, ProcessMeta, Frontmatter, LoadResult } from './types/index.js';

export type { LexResult } from './lexer.js';
export type { ParseResult } from './parser.js';
export type { NormalizeResult } from './normalizer.js';

export interface ParseDocResult {
  document: import('./types/index.js').Document;
  frontmatter: import('./types/index.js').Frontmatter | null;
  diagnostics: import('./types/index.js').Diagnostic[];
}

export interface FormatResult {
  output: string;
  diagnostics: import('./types/index.js').Diagnostic[];
}

export function parse(source: string): ParseDocResult {
  const { frontmatter, body, diagnostics: fmDiags, bodyStartLine } = loadFrontmatter(source);
  const { tokens, diagnostics: lexDiags } = lex(body);
  // Adjust token positions by bodyStartLine offset
  const lineOffset = bodyStartLine - 1;
  if (lineOffset > 0) {
    for (const t of tokens) {
      t.start = { ...t.start, line: t.start.line + lineOffset };
      t.end   = { ...t.end,   line: t.end.line   + lineOffset };
    }
  }
  const { document, diagnostics: parseDiags } = parseTokens(tokens);
  return {
    document,
    frontmatter,
    diagnostics: [...fmDiags, ...lexDiags, ...parseDiags],
  };
}

export {
  normalize as normalizeDocument,
  buildGraphInternal as buildGraph,
  validate as validateGraph,
  sortEdges,
  formatEdges,
};

export function format(source: string): FormatResult {
  const diagnostics: import('./types/index.js').Diagnostic[] = [];
  const { frontmatter, body, diagnostics: fmDiags } = loadFrontmatter(source);
  diagnostics.push(...fmDiags);

  const { tokens, diagnostics: lexDiags } = lex(body);
  diagnostics.push(...lexDiags);

  const { document, diagnostics: parseDiags } = parseTokens(tokens);
  diagnostics.push(...parseDiags);

  const { edges, nodeKinds, diagnostics: normDiags } = normalize(document, frontmatter);
  diagnostics.push(...normDiags);

  const graph = buildGraphInternal(edges, nodeKinds);
  diagnostics.push(...validate(edges, graph, frontmatter));

  const sorted = sortEdges(edges, graph);
  return { output: formatEdges(sorted), diagnostics };
}
```

- [ ] **Step 4: Run integration tests**

```bash
cd packages/core && pnpm test index
```
Expected: all 5 tests pass (including idempotency check).

- [ ] **Step 5: Run full test suite**

```bash
cd packages/core && pnpm test
```
Expected: all tests pass across all modules.

- [ ] **Step 6: Typecheck**

```bash
cd packages/core && pnpm typecheck
```
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.test.ts
git commit -m "feat(core): wire public API with integration tests against sample .pfdsl"
```

---

## Verification

### End-to-end check
```bash
# From repo root
pnpm test
# Expected: all tests pass

pnpm typecheck
# Expected: no TS errors
```

### Manual smoke test

Create `test.pfdsl`:
```
req >> design -> spec
spec >> impl -> code
code >> test -> release
code >>? impl
```

Then from a Node.js REPL or quick script:
```typescript
import { format } from './packages/core/src/index.js';
import { readFileSync } from 'node:fs';
const src = readFileSync('test.pfdsl', 'utf-8');
const { output, diagnostics } = format(src);
console.log(diagnostics);  // expect []
console.log(output);
// Expected output (canonical order):
// req >> design
// design -> spec
// spec >> impl
// code >>? impl
// impl -> code
// code >> test
// test -> release
```

### Integration test with `docs/pfdsl_implementation_flow.pfdsl`
The `index.test.ts` integration test already covers this:
- `parse`: no syntax errors, frontmatter populated
- `normalizeDocument`: no type contradiction errors
- `validateGraph`: no constraint violations
- `format`: produces non-empty output, ends with newline
- `format` idempotency: `format(format(src)) === format(src)`

---

## Implementation Notes

**Formatter design decision:** Phase 1 outputs individual edges in canonical order (no chain reconstruction, no comment preservation). IDs containing spaces are output as-is without quoting — the formatter trusts that normalized edge IDs are valid bare-ids. Quoted-id rendering can be added in Phase 2 if needed.

**Position accuracy:** The normalizer and validator use `zeroRange()` (position 1:1) for all diagnostics since position info is lost during normalization. Phase 2 can thread source positions through the AST for accurate error locations.

**Spec open question (v0.0.3 candidate):** The formatter currently does not reconstruct chain notation. Whether to do so is noted in the spec as a design decision to be made. For Phase 1, flat edge-per-line output is sufficient and unambiguous.
