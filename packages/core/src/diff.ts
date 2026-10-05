import { formatId } from "./formatter.js";
import { resolveMeta } from "./meta.js";
import type {
	FeedbackEdge,
	Frontmatter,
	Graph,
	PrimaryEdge,
} from "./types/index.js";

export interface DiffReport {
	addedNodes: string[];
	removedNodes: string[];
	changedNodes: string[];
	addedEdges: string[];
	removedEdges: string[];
	addedFeedback: string[];
	removedFeedback: string[];
}

export type EdgeDiffStatus = "added" | "removed" | "unchanged";

export type ClassifiedPrimaryEdge = Pick<PrimaryEdge, "from" | "to"> & {
	status: EdgeDiffStatus;
};
export type ClassifiedFeedbackEdge = FeedbackEdge & { status: EdgeDiffStatus };

/** Endpoint classifications for renderers, alongside the compatible display report. */
export interface DetailedDiffReport {
	report: DiffReport;
	primaryEdges: ClassifiedPrimaryEdge[];
	feedbackEdges: ClassifiedFeedbackEdge[];
}

function classifyEdges<E>(
	a: E[],
	b: E[],
	endpoints: (edge: E) => [string, string],
): (E & { status: EdgeDiffStatus })[] {
	// JSON tuples are identity keys only; display spelling never determines identity.
	const key = (edge: E) => JSON.stringify(endpoints(edge));
	const before = new Map(a.map((edge) => [key(edge), edge]));
	const after = new Map(b.map((edge) => [key(edge), edge]));
	const result: (E & { status: EdgeDiffStatus })[] = [];
	for (const [id, edge] of before) {
		result.push({ ...edge, status: after.has(id) ? "unchanged" : "removed" });
	}
	for (const [id, edge] of after) {
		if (!before.has(id)) result.push({ ...edge, status: "added" });
	}
	return result;
}

function displayEdges<E extends { status: EdgeDiffStatus }>(
	edges: E[],
	status: EdgeDiffStatus,
	endpoints: (edge: E) => [string, string],
): string[] {
	return edges
		.filter((edge) => edge.status === status)
		.map((edge) => {
			const [from, to] = endpoints(edge);
			return `${formatId(from)} -> ${formatId(to)}`;
		})
		.sort();
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
	return diffGraphsDetailed(a, b, fmA, fmB).report;
}

/** Compute edge identity and classification once for both display and rendering. */
export function diffGraphsDetailed(
	a: Graph,
	b: Graph,
	fmA?: Frontmatter | null,
	fmB?: Frontmatter | null,
): DetailedDiffReport {
	const aNodes = new Set(a.nodes.keys());
	const bNodes = new Set(b.nodes.keys());
	const primaryEndpoints = (
		edge: Pick<PrimaryEdge, "from" | "to">,
	): [string, string] => [edge.from, edge.to];
	const feedbackEndpoints = (edge: FeedbackEdge): [string, string] => [
		edge.artifact,
		edge.process,
	];
	const primaryEdges = classifyEdges(
		a.primaryEdges,
		b.primaryEdges,
		primaryEndpoints,
	);
	const feedbackEdges = classifyEdges(
		a.feedbackEdges,
		b.feedbackEdges,
		feedbackEndpoints,
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
		report: {
			addedNodes: setDiff(aNodes, bNodes),
			removedNodes: setDiff(bNodes, aNodes),
			changedNodes,
			addedEdges: displayEdges(primaryEdges, "added", primaryEndpoints),
			removedEdges: displayEdges(primaryEdges, "removed", primaryEndpoints),
			addedFeedback: displayEdges(feedbackEdges, "added", feedbackEndpoints),
			removedFeedback: displayEdges(
				feedbackEdges,
				"removed",
				feedbackEndpoints,
			),
		},
		primaryEdges,
		feedbackEdges,
	};
}
