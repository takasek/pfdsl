import type { EdgeGroups } from "../edge-groups.js";
import { groupEdges } from "../edge-groups.js";
import {
	findFrontmatterNodeRanges,
	frontmatterNodeRanges,
} from "../frontmatter.js";
import type { FrontmatterSource } from "../frontmatter-source.js";
import { edgeOccurrences } from "../normalizer.js";
import { zeroRange } from "../position.js";
import type {
	ArtifactMeta,
	Diagnostic,
	DiagnosticSeverity,
	Document,
	Frontmatter,
	NodeKind,
	NormalizedEdge,
	ProcessMeta,
	Range,
} from "../types/index.js";

export interface ValidateOptions {
	strict?: boolean;
	source?: string;
	sourceMap?: FrontmatterSource;
	/** Parsed body, which locates diagnostics about authored edges. */
	document?: Document;
	readyGate?: boolean;
}

/**
 * Everything a rule may read. The derived views (edge groups, adjacency,
 * declared metadata) are built once here rather than per rule, which is what
 * previously kept the whole check in a single function body.
 */
export interface RuleContext {
	readonly edges: NormalizedEdge[];
	readonly nodeKinds: Map<string, NodeKind>;
	readonly fm: Frontmatter | null;
	readonly options: ValidateOptions;

	/** Declared artifact metadata, with YAML nulls normalized away. */
	readonly artifactMeta: Record<string, ArtifactMeta>;
	/** Declared process metadata, with YAML nulls normalized away. */
	readonly processMeta: Record<string, ProcessMeta>;

	readonly edgeGroups: EdgeGroups;
	/** Every process that appears on at least one edge of any kind. */
	readonly edgeProcesses: Set<string>;
	/** Every node id that appears on at least one edge of any kind. */
	readonly nodesWithEdges: Set<string>;
	/** Primary-graph adjacency: artifact→process for inputs, process→artifact for outputs. */
	readonly primaryAdj: Map<string, string[]>;

	/** Range of a node's front-matter declaration, when the source was supplied. */
	rangeOf(id: string): Range;
	/** Range of an edge's first authored occurrence, when the document was supplied. */
	edgeRange(edge: NormalizedEdge): Range;
	/** Range of a process ID's first appearance as a process on a body edge, when the document was supplied. */
	processRangeOf(id: string): Range;
	/** `error` under --strict, the given severity otherwise. */
	strictly(severity: DiagnosticSeverity): DiagnosticSeverity;
}

export type Rule = (ctx: RuleContext) => Diagnostic[];

/** Drop YAML-null entries (`id:` with no value) down to an empty record. */
function withoutNulls<T>(entries: Record<string, T | null> | undefined) {
	const out: Record<string, T> = {};
	for (const [id, meta] of Object.entries(entries ?? {})) {
		out[id] = meta ?? ({} as T);
	}
	return out;
}

/** Map key identifying an edge by its kind and endpoints. */
function edgeRangeKey(edge: NormalizedEdge): string {
	return JSON.stringify([edge.kind, edge.artifact, edge.process]);
}

interface BodyRangeIndex {
	edges: Map<string, Range>;
	processes: Map<string, Range>;
}

/**
 * Each edge's first authored occurrence, spanning its two endpoint IDs in
 * source order, and each process ID's first occurrence in the process role,
 * from one pass over the document.
 */
function bodyRangeIndex(document: Document): BodyRangeIndex {
	const edges = new Map<string, Range>();
	const processes = new Map<string, Range>();
	for (const stmt of document.statements) {
		for (const { kind, artifact, process } of edgeOccurrences(stmt)) {
			const seen = processes.get(process.value);
			if (!seen || process.start.offset < seen.start.offset)
				processes.set(process.value, {
					start: process.start,
					end: process.end,
				});
			const key = edgeRangeKey({
				kind,
				artifact: artifact.value,
				process: process.value,
			});
			if (edges.has(key)) continue;
			edges.set(
				key,
				kind === "output"
					? { start: process.start, end: artifact.end }
					: { start: artifact.start, end: process.end },
			);
		}
	}
	return { edges, processes };
}

export function buildRuleContext(
	edges: NormalizedEdge[],
	nodeKinds: Map<string, NodeKind>,
	fm: Frontmatter | null,
	options: ValidateOptions = {},
): RuleContext {
	const nodeRanges = options.sourceMap
		? frontmatterNodeRanges(options.sourceMap)
		: options.source
			? findFrontmatterNodeRanges(options.source)
			: new Map<string, Range>();
	let bodyRanges: BodyRangeIndex | undefined;
	// Built on first use, so documents with no located diagnostic skip it.
	const located = () => {
		if (options.document && !bodyRanges)
			bodyRanges = bodyRangeIndex(options.document);
		return bodyRanges;
	};

	const edgeGroups = groupEdges(edges);
	const edgeProcesses = new Set<string>([
		...edgeGroups.processInputs.keys(),
		...edgeGroups.processOutputs.keys(),
		...edgeGroups.processFeedback.keys(),
	]);

	const nodesWithEdges = new Set<string>();
	const primaryAdj = new Map<string, string[]>();
	for (const e of edges) {
		nodesWithEdges.add(e.artifact);
		nodesWithEdges.add(e.process);
		if (e.kind === "input") {
			primaryAdj.set(e.artifact, [
				...(primaryAdj.get(e.artifact) ?? []),
				e.process,
			]);
		} else if (e.kind === "output") {
			primaryAdj.set(e.process, [
				...(primaryAdj.get(e.process) ?? []),
				e.artifact,
			]);
		}
	}

	return {
		edges,
		nodeKinds,
		fm,
		options,
		artifactMeta: withoutNulls<ArtifactMeta>(fm?.artifact),
		processMeta: withoutNulls<ProcessMeta>(fm?.process),
		edgeGroups,
		edgeProcesses,
		nodesWithEdges,
		primaryAdj,
		rangeOf: (id) => nodeRanges.get(id) ?? zeroRange(),
		edgeRange: (edge) =>
			located()?.edges.get(edgeRangeKey(edge)) ?? zeroRange(),
		processRangeOf: (id) => located()?.processes.get(id) ?? zeroRange(),
		strictly: (severity) => (options.strict ? "error" : severity),
	};
}
