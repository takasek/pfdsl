import type { Frontmatter, Graph } from "@pfdsl/core";
import {
	type ExportOptions,
	exportDiffDot,
	exportDot,
} from "@pfdsl/graphviz-exporter/dot";

export type { ExportOptions } from "@pfdsl/graphviz-exporter/dot";
export { exportDiffDot } from "@pfdsl/graphviz-exporter/dot";

export type RenderFormat = "svg" | "dot";

export interface RenderOptions extends ExportOptions {
	format?: RenderFormat;
}

import { renderDotToSvg } from "./renderer.js";

export { renderDotToSvg } from "./renderer.js";

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
