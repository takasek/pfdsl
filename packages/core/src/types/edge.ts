export type NormalizedEdge =
  | { kind: 'input';    artifact: string; process: string }
  | { kind: 'feedback'; artifact: string; process: string }
  | { kind: 'output';   process: string;  artifact: string };
