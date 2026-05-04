import { loadFrontmatter } from './frontmatter.js';
import { lex } from './lexer.js';
import { parseTokens } from './parser.js';
import { normalize } from './normalizer.js';
import { buildGraph as buildGraphInternal } from './graph.js';
import { sortEdges } from './sorter.js';
import { validate } from './validator.js';
import { formatEdges } from './formatter.js';
import type {
  Document, Frontmatter, Diagnostic, Graph, NodeKind, NormalizedEdge,
} from './types/index.js';

export type { TokenType, Position, Token } from './types/index.js';
export type {
  IdNode, ArtifactExpr, ChainSegment,
  ChainStatement, InputEdgeStatement, FeedbackEdgeStatement, OutputEdgeStatement,
  Statement, Document,
} from './types/index.js';
export type { NormalizedEdge } from './types/index.js';
export type { NodeKind, PrimaryEdge, FeedbackEdge, Graph } from './types/index.js';
export type { DiagnosticSeverity, Range, Diagnostic } from './types/index.js';
export type {
  ArtifactMeta, ProcessMeta, Frontmatter, LoadResult,
  Status, StyleAttr, NodeStyle,
} from './types/index.js';
export { STATUS_VALUES, STYLE_ATTRS } from './types/index.js';

export type { LexResult } from './lexer.js';
export type { ParseResult } from './parser.js';
export type { NormalizeResult } from './normalizer.js';

export interface ParseDocResult {
  document: Document;
  frontmatter: Frontmatter | null;
  diagnostics: Diagnostic[];
}

export interface FormatResult {
  output: string;
  diagnostics: Diagnostic[];
}

export interface AnalyzeResult {
  document: Document;
  frontmatter: Frontmatter | null;
  edges: NormalizedEdge[];
  nodeKinds: Map<string, NodeKind>;
  graph: Graph;
  diagnostics: Diagnostic[];
}

export function parse(source: string): ParseDocResult {
  const { frontmatter, body, diagnostics: fmDiags, bodyStartLine } = loadFrontmatter(source);
  const { tokens, diagnostics: lexDiags } = lex(body);
  // Adjust token positions by bodyStartLine offset
  const lineOffset = bodyStartLine - 1;
  if (lineOffset > 0) {
    for (const t of tokens) {
      t.start.line += lineOffset;
      t.end.line   += lineOffset;
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

export function analyze(source: string): AnalyzeResult {
  const { document, frontmatter, diagnostics: parseDiags } = parse(source);
  const { edges, nodeKinds, diagnostics: normDiags } = normalize(document, frontmatter);
  const valDiags = validate(edges, nodeKinds, frontmatter);
  const graph = buildGraphInternal(edges, nodeKinds);
  return {
    document,
    frontmatter,
    edges,
    nodeKinds,
    graph,
    diagnostics: [...parseDiags, ...normDiags, ...valDiags],
  };
}

export function format(source: string): FormatResult {
  const { document, frontmatter, diagnostics: parseDiags } = parse(source);
  const { edges, nodeKinds, diagnostics: normDiags } = normalize(document, frontmatter);
  const graph = buildGraphInternal(edges, nodeKinds);
  const valDiags = validate(edges, nodeKinds, frontmatter);
  const sorted = sortEdges(edges, graph);
  return {
    output: formatEdges(sorted),
    diagnostics: [...parseDiags, ...normDiags, ...valDiags],
  };
}
