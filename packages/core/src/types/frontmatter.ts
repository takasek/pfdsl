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
