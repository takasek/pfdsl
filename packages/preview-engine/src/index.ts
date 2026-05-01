import { Graphviz } from '@hpcc-js/wasm';
import { exportDot, type ExportOptions } from '@pfdsl/graphviz-exporter';
import type { Graph, Frontmatter } from '@pfdsl/core';

export type { ExportOptions } from '@pfdsl/graphviz-exporter';

export type RenderFormat = 'svg' | 'dot';

export interface RenderOptions extends ExportOptions {
  format?: RenderFormat;
}

type GraphvizInstance = Awaited<ReturnType<typeof Graphviz.load>>;

let graphvizInstance: Promise<GraphvizInstance> | null = null;

function getGraphviz(): Promise<GraphvizInstance> {
  if (!graphvizInstance) {
    graphvizInstance = Graphviz.load();
  }
  return graphvizInstance;
}

export async function renderDotToSvg(dot: string): Promise<string> {
  const gv = await getGraphviz();
  return gv.dot(dot, 'svg');
}

export async function renderGraph(
  graph: Graph,
  frontmatter: Frontmatter | null = null,
  options: RenderOptions = {}
): Promise<string> {
  const dot = exportDot(graph, frontmatter, options);
  if (options.format === 'dot') return dot;
  return renderDotToSvg(dot);
}
