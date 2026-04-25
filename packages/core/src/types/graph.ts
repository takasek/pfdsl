export type NodeKind = 'artifact' | 'process';

export interface Graph {
  nodes: Map<string, NodeKind>;
  primaryEdges: Array<{ from: string; to: string; kind: 'input' | 'output' }>;
  feedbackEdges: Array<{ artifact: string; process: string }>;
}
