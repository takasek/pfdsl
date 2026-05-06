import type {
	FeedbackEdge,
	Graph,
	NodeKind,
	NormalizedEdge,
	PrimaryEdge,
} from "./types/index.js";

export function buildGraph(
	edges: NormalizedEdge[],
	nodeKinds: Map<string, NodeKind>,
): Graph {
	const nodes = new Map<string, NodeKind>(nodeKinds);
	const primaryEdges: PrimaryEdge[] = [];
	const feedbackEdges: FeedbackEdge[] = [];

	for (const edge of edges) {
		if (edge.kind === "input") {
			if (!nodes.has(edge.artifact)) nodes.set(edge.artifact, "artifact");
			if (!nodes.has(edge.process)) nodes.set(edge.process, "process");
			primaryEdges.push({
				from: edge.artifact,
				to: edge.process,
				kind: "input",
			});
		} else if (edge.kind === "output") {
			if (!nodes.has(edge.process)) nodes.set(edge.process, "process");
			if (!nodes.has(edge.artifact)) nodes.set(edge.artifact, "artifact");
			primaryEdges.push({
				from: edge.process,
				to: edge.artifact,
				kind: "output",
			});
		} else {
			// feedback
			if (!nodes.has(edge.artifact)) nodes.set(edge.artifact, "artifact");
			if (!nodes.has(edge.process)) nodes.set(edge.process, "process");
			feedbackEdges.push({ artifact: edge.artifact, process: edge.process });
		}
	}

	return { nodes, primaryEdges, feedbackEdges };
}
