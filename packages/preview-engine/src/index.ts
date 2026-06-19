import { Graphviz } from "@hpcc-js/wasm";
import type { Frontmatter, Graph } from "@pfdsl/core";
import {
	type ExportOptions,
	exportDiffDot,
	exportDot,
} from "@pfdsl/graphviz-exporter";

export type { ExportOptions } from "@pfdsl/graphviz-exporter";
export { exportDiffDot } from "@pfdsl/graphviz-exporter";

export type RenderFormat = "svg" | "dot";

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
	return gv.dot(dot, "svg");
}

export async function renderGraph(
	graph: Graph,
	frontmatter: Frontmatter | null = null,
	options: RenderOptions = {},
): Promise<string> {
	const dot = exportDot(graph, frontmatter, options);
	if (options.format === "dot") return dot;
	return renderDotToSvg(dot);
}

export async function renderDiff(
	a: Graph,
	fmA: Frontmatter | null,
	b: Graph,
	fmB: Frontmatter | null,
	options: RenderOptions = {},
): Promise<string> {
	const dot = exportDiffDot(a, fmA, b, fmB, options);
	if (options.format === "dot") return dot;
	return renderDotToSvg(dot);
}
