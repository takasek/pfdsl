import type { EdgeSet, NormalizedEdge, Graph } from './types/index.js';

export function sortEdges(edges: EdgeSet, graph: Graph): NormalizedEdge[] {
  // Union-Find for connected components (primary graph, undirected)
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x) ?? x;
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
  const hasIncoming = new Set(graph.primaryEdges.map(e => e.to));
  const ranks = new Map<string, number>();

  for (const [id, kind] of graph.nodes) {
    if (kind === 'artifact' && !hasIncoming.has(id)) ranks.set(id, 0);
  }

  // Rank propagation converges in at most V passes on a DAG; cap iterations to
  // guard against cyclic primary graphs.
  let changed = true;
  let iterations = 0;
  const maxIterations = graph.nodes.size + 1;
  while (changed && iterations < maxIterations) {
    iterations++;
    changed = false;
    for (const e of graph.primaryEdges) {
      const r = (ranks.get(e.from) ?? 0) + 1;
      if (r > (ranks.get(e.to) ?? -1)) { ranks.set(e.to, r); changed = true; }
    }
  }

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

  function edgeLexKey(e: NormalizedEdge): string {
    return e.kind === 'output'
      ? `${e.process}\0${e.artifact}`
      : `${e.artifact}\0${e.process}`;
  }

  const compKeys = new Map<NormalizedEdge, string>();
  for (const e of edges.edges) {
    const ref = e.kind === 'output' ? e.process : e.artifact;
    compKeys.set(e, componentKey(ref));
  }

  return [...edges.edges].sort((a, b) => {
    const ck = compKeys.get(a)!.localeCompare(compKeys.get(b)!);
    if (ck !== 0) return ck;
    const rk = edgeRank(a) - edgeRank(b);
    if (rk !== 0) return rk;
    const kk = edgeKindOrder(a) - edgeKindOrder(b);
    if (kk !== 0) return kk;
    return edgeLexKey(a).localeCompare(edgeLexKey(b));
  });
}
