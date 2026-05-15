import type { Graph } from "./types/index.js";

export interface DiffReport {
	addedNodes: string[];
	removedNodes: string[];
	addedEdges: string[];
	removedEdges: string[];
	addedFeedback: string[];
	removedFeedback: string[];
}

function edgeKey(from: string, to: string): string {
	return `${from} -> ${to}`;
}

function setDiff(lhs: Set<string>, rhs: Set<string>): string[] {
	return [...rhs].filter((x) => !lhs.has(x)).sort();
}

export function diffGraphs(a: Graph, b: Graph): DiffReport {
	const aNodes = new Set(a.nodes.keys());
	const bNodes = new Set(b.nodes.keys());
	const aEdges = new Set(a.primaryEdges.map((e) => edgeKey(e.from, e.to)));
	const bEdges = new Set(b.primaryEdges.map((e) => edgeKey(e.from, e.to)));
	const aFb = new Set(
		a.feedbackEdges.map((e) => edgeKey(e.artifact, e.process)),
	);
	const bFb = new Set(
		b.feedbackEdges.map((e) => edgeKey(e.artifact, e.process)),
	);
	return {
		addedNodes: setDiff(aNodes, bNodes),
		removedNodes: setDiff(bNodes, aNodes),
		addedEdges: setDiff(aEdges, bEdges),
		removedEdges: setDiff(bEdges, aEdges),
		addedFeedback: setDiff(aFb, bFb),
		removedFeedback: setDiff(bFb, aFb),
	};
}
