import {
  parse,
  normalizeDocument,
  buildGraph,
  validateGraph,
  format as formatSource,
  type Diagnostic,
  type Frontmatter,
  type Graph,
  type NodeKind,
} from '@pfdsl/core';

export interface AnalyzeResult {
  diagnostics: Diagnostic[];
  frontmatter: Frontmatter | null;
  graph: Graph | null;
  nodeKinds: Map<string, NodeKind>;
}

export function analyze(source: string): AnalyzeResult {
  const { document, frontmatter, diagnostics: parseDiags } = parse(source);
  const { edges, nodeKinds, diagnostics: normDiags } = normalizeDocument(document, frontmatter);
  const valDiags = validateGraph(edges, nodeKinds, frontmatter);
  const graph = buildGraph(edges, nodeKinds);
  return {
    diagnostics: [...parseDiags, ...normDiags, ...valDiags],
    frontmatter,
    graph,
    nodeKinds,
  };
}

export { formatSource };
