import {
	analyzeSource,
	computeNeighbors,
	type Frontmatter,
	type Graph,
	insertDefinition,
	loadFrontmatter,
	type Range,
	STYLE_ATTRS,
} from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter/dot";
import {
	buildConnectorEdgeLine,
	type ConnectorKind,
	compatibleOtherKind,
	edgeAlreadyExists,
	insertConnectorEdge,
	validateNewNodeId,
} from "./connector-logic.js";
import {
	findDefinitionEditTarget,
	findUndefinedNodeKind,
} from "./def-insertion-logic.js";
import type { DocumentModel } from "./document.js";

export interface PreviewGraph {
	nodes: Array<[string, "artifact" | "process" | "group"]>;
	primaryEdges: Graph["primaryEdges"];
	feedbackEdges: Graph["feedbackEdges"];
	frontmatter: Frontmatter | null;
}
export type PreviewEditRequest =
	| { type: "createDefinition"; nodeId: string; source: string }
	| {
			type: "addConnector";
			nodeId: string;
			source: string;
			connector: ConnectorKind;
			otherId: string;
	  };

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

export type PreviewEditResult =
	| { ok: false; message: string }
	| {
			ok: true;
			source: string;
			selection?: Range | undefined;
			needsCriteria?: boolean | undefined;
	  };

/** A menu belongs to the exact authored source from which its candidates were calculated. */
export function applyPreviewEdit(
	source: string,
	request: PreviewEditRequest,
): PreviewEditResult {
	const fail = (message: string): PreviewEditResult => ({ ok: false, message });
	if (request.source !== source)
		return fail("The document changed. Reopen Node actions and try again.");
	const model = { ...analyzeSource(source), source };
	if (
		model.diagnostics.some(
			(d) => d.severity === "error" && /^(FM|L|P|N)\d+$/.test(d.code),
		)
	)
		return fail(
			"The document cannot be parsed safely. Fix its diagnostics first.",
		);
	const kind = model.nodeKinds.get(request.nodeId);
	if (kind !== "artifact" && kind !== "process")
		return fail("The target node no longer exists.");
	if (request.type === "createDefinition") {
		if (
			!findUndefinedNodeKind(model.nodeKinds, model.frontmatter, request.nodeId)
		)
			return fail("This node already has a definition.");
		const inserted = insertDefinition(source, kind, request.nodeId);
		if (!inserted.inserted)
			return fail("The definition could not be inserted safely.");
		const output = inserted.output + loadFrontmatter(source).body;
		const target = findDefinitionEditTarget(
			analyzeSource(output),
			kind,
			request.nodeId,
		);
		return {
			ok: true,
			source: output,
			selection: target?.labelRange,
			needsCriteria: target?.needsCriteria,
		};
	}
	if (![">>", ">>?", "->"].includes(request.connector))
		return fail("Unknown connector.");
	const invalid = validateNewNodeId({
		value: request.otherId,
		currentNodeId: request.nodeId,
		wantedKind: compatibleOtherKind(kind),
		kindOfExisting: (id) => model.nodeKinds.get(id),
	});
	if (invalid) return fail(invalid);
	if (
		edgeAlreadyExists(
			model.edges,
			request.nodeId,
			kind,
			request.connector,
			request.otherId,
		)
	)
		return fail("This connection already exists.");
	const edge = buildConnectorEdgeLine(
		request.nodeId,
		kind,
		request.connector,
		request.otherId,
	);
	return {
		ok: true,
		source: insertConnectorEdge(source, edge, request.nodeId).text,
	};
}
