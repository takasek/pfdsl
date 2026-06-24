import { resolveMeta } from "./meta.js";
import type { Frontmatter, Graph } from "./types/index.js";

export interface DiffReport {
	addedNodes: string[];
	removedNodes: string[];
	changedNodes: string[];
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

/**
 * Stable JSON serialization that sorts object keys recursively.
 * Arrays are compared in order (element order is NOT sorted).
 */
function stableStringify(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const keys = Object.keys(value as object).sort();
	const pairs = keys
		.map((k) => {
			const v = (value as Record<string, unknown>)[k];
			if (v === undefined) return null;
			return `${JSON.stringify(k)}:${stableStringify(v)}`;
		})
		.filter((p) => p !== null);
	return `{${pairs.join(",")}}`;
}

export function diffGraphs(
	a: Graph,
	b: Graph,
	fmA?: Frontmatter | null,
	fmB?: Frontmatter | null,
): DiffReport {
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

	// Nodes present in both graphs (not added/removed)
	const commonIds = [...aNodes].filter((id) => bNodes.has(id));

	const changedNodes: string[] = [];
	for (const id of commonIds) {
		const kindA = a.nodes.get(id);
		const kindB = b.nodes.get(id);

		// Kind differs → changed
		if (kindA !== kindB) {
			changedNodes.push(id);
			continue;
		}

		// Metadata comparison — only when both frontmatters are provided
		if (fmA != null && fmB != null && kindB != null) {
			const metaA = resolveMeta(fmA, kindB, id);
			const metaB = resolveMeta(fmB, kindB, id);

			if (stableStringify(metaA) !== stableStringify(metaB)) {
				changedNodes.push(id);
			}
		}
	}

	changedNodes.sort();

	return {
		addedNodes: setDiff(aNodes, bNodes),
		removedNodes: setDiff(bNodes, aNodes),
		changedNodes,
		addedEdges: setDiff(aEdges, bEdges),
		removedEdges: setDiff(bEdges, aEdges),
		addedFeedback: setDiff(aFb, bFb),
		removedFeedback: setDiff(bFb, aFb),
	};
}
