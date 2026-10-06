import {
	computeNeighbors,
	type Frontmatter,
	type Graph,
	STYLE_ATTRS,
} from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter/dot";
import type { DocumentModel } from "./document.js";

export interface PreviewGraph {
	nodes: Array<[string, "artifact" | "process" | "group"]>;
	primaryEdges: Graph["primaryEdges"];
	feedbackEdges: Graph["feedbackEdges"];
	frontmatter: Frontmatter | null;
}
export function buildPreviewGraph(
	model: DocumentModel,
	frontmatter: Frontmatter | null,
): PreviewGraph {
	return {
		nodes: [...model.graph.nodes],
		primaryEdges: model.graph.primaryEdges,
		feedbackEdges: model.graph.feedbackEdges,
		frontmatter: previewFrontmatter(model.graph, frontmatter),
	};
}

/** The wire graph carries renderable metadata, never arbitrary YAML extension objects. */
function previewFrontmatter(
	graph: Graph,
	frontmatter: Frontmatter | null,
): Frontmatter | null {
	if (!frontmatter) return null;
	const scalarFields = (meta: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(meta).filter(
				([, value]) =>
					typeof value === "string" ||
					(Array.isArray(value) && value.every((v) => typeof v === "string")),
			),
		);
	const style = (meta: Record<string, unknown>) =>
		Object.fromEntries(
			STYLE_ATTRS.flatMap((key) =>
				typeof meta[key] === "string" ? [[key, meta[key]]] : [],
			),
		);
	const projected: Frontmatter = {};
	for (const kind of ["artifact", "process"] as const) {
		projected[kind] = Object.fromEntries(
			[...graph.nodes].flatMap(([id, nodeKind]) => {
				const meta = frontmatter[kind]?.[id];
				return nodeKind === kind && meta ? [[id, scalarFields(meta)]] : [];
			}),
		);
	}
	projected.tag = Object.fromEntries(
		Object.entries(frontmatter.tag ?? {}).map(([id, meta]) => [
			id,
			{ style: style(meta.style ?? {}) },
		]),
	);
	projected.statusStyles = Object.fromEntries(
		Object.entries(frontmatter.statusStyles ?? {}).map(([id, meta]) => [
			id,
			style(meta),
		]),
	);
	if (typeof frontmatter.layout?.maxWidth === "number")
		projected.layout = { maxWidth: frontmatter.layout.maxWidth };
	return projected;
}

/** Keep incident edges, including parallel primary/feedback pairs, and no second-hop edges. */
export function neighborhoodDot(
	data: PreviewGraph,
	id: string,
): string | undefined {
	const graph: Graph = { ...data, nodes: new Map(data.nodes) };
	if (!graph.nodes.has(id) || graph.nodes.get(id) === "group") return undefined;
	const neighbors = computeNeighbors(graph, id);
	const ids = new Set([
		id,
		...neighbors.predecessors.map((n) => n.id),
		...neighbors.successors.map((n) => n.id),
	]);
	const local: Graph = {
		nodes: new Map([...graph.nodes].filter(([node]) => ids.has(node))),
		primaryEdges: graph.primaryEdges.filter(
			(e) => e.from === id || e.to === id,
		),
		feedbackEdges: graph.feedbackEdges.filter(
			(e) => e.artifact === id || e.process === id,
		),
	};
	// Group containers/title are global context; local nodes retain their metadata and styles.
	const frontmatter = { ...data.frontmatter };
	delete frontmatter.title;
	delete frontmatter.group;
	return exportDot(local, frontmatter, { graphLabel: "", rankdir: "LR" });
}
