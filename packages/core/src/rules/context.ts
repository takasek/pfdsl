import type { EdgeGroups } from "../edge-groups.js";
import { groupEdges } from "../edge-groups.js";
import { findFrontmatterNodeRanges } from "../frontmatter.js";
import { zeroRange } from "../position.js";
import type {
	ArtifactMeta,
	Diagnostic,
	DiagnosticSeverity,
	Frontmatter,
	NodeKind,
	NormalizedEdge,
	ProcessMeta,
	Range,
} from "../types/index.js";

export interface ValidateOptions {
	strict?: boolean;
	source?: string;
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

export function buildRuleContext(
	edges: NormalizedEdge[],
	nodeKinds: Map<string, NodeKind>,
	fm: Frontmatter | null,
	options: ValidateOptions = {},
): RuleContext {
	const nodeRanges = options.source
		? findFrontmatterNodeRanges(options.source)
		: new Map<string, Range>();

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
		strictly: (severity) => (options.strict ? "error" : severity),
	};
}
