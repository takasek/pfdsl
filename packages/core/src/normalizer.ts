import type {
  Document, Statement, ArtifactExpr,
  NormalizedEdge,
  Frontmatter,
  Diagnostic,
} from './types/index.js';
import { zeroRange } from './position.js';

export interface NormalizeResult {
  edges: NormalizedEdge[];
  nodeKinds: Map<string, 'artifact' | 'process'>;
  diagnostics: Diagnostic[];
}

function edgeKey(edge: NormalizedEdge): string {
  return edge.kind === 'output'
    ? `output\0${edge.process}\0${edge.artifact}`
    : `${edge.kind}\0${edge.artifact}\0${edge.process}`;
}

export function normalize(doc: Document, fm: Frontmatter | null): NormalizeResult {
  const diagnostics: Diagnostic[] = [];
  const rawEdges: NormalizedEdge[] = [];
  const seenEdges = new Set<string>();
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
    const key = edgeKey(edge);
    if (seenEdges.has(key)) {
      diagnostics.push({ severity: 'warning', code: 'N003',
        message: 'Duplicate edge', range: zeroRange() });
      return;
    }
    seenEdges.add(key);
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

  return { edges: rawEdges, nodeKinds, diagnostics };
}
