import type { Diagnostic } from './diagnostic.js';

export const STATUS_VALUES = ['done', 'wip', 'todo', 'blocked'] as const;
export type Status = typeof STATUS_VALUES[number];

export const STYLE_ATTRS = ['fillcolor', 'color', 'fontcolor', 'style', 'penwidth'] as const;
export type StyleAttr = typeof STYLE_ATTRS[number];
export type NodeStyle = Partial<Record<StyleAttr, string>>;

export interface ArtifactMeta {
  title?: string;
  owner?: string;
  parts?: string[];
  status?: Status;
  tags?: string[];
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
  statusStyles?: Partial<Record<Status, NodeStyle>>;
  tagStyles?: Record<string, NodeStyle>;
  [key: string]: unknown;
}

export interface LoadResult {
  frontmatter: Frontmatter | null;
  body: string;
  bodyStartLine: number;  // 1-based line where body starts
  diagnostics: Diagnostic[];
}
