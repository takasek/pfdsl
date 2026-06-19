import type { ArtifactMeta } from "./types/frontmatter.js";
import type { NodeKind, NormalizedEdge } from "./types/index.js";

export interface AuditResult {
	/** Artifacts produced by a process but not consumed by any process */
	terminals: string[];
	/** Artifacts consumed by a process but not produced by any process */
	externalInputs: string[];
}

/**
 * Inspect the primary graph for terminal artifacts and external inputs.
 *
 * Feedback edges are ignored: only `input` and `output` edges count as
 * production/consumption in the primary graph.
 *
 * Artifacts with a non-empty `externalStakeholders` list are treated as
 * having an external consumer and are excluded from terminals.
 */
export function auditGraph(
	edges: NormalizedEdge[],
	nodeKinds: Map<string, NodeKind>,
	artifactMeta?: Record<string, ArtifactMeta>,
): AuditResult {
	const produced = new Set<string>();
	const consumed = new Set<string>();

	for (const e of edges) {
		if (e.kind === "output") {
			produced.add(e.artifact);
		} else if (e.kind === "input") {
			consumed.add(e.artifact);
		}
		// feedback edges intentionally ignored
	}

	const artifacts: string[] = [];
	for (const [id, kind] of nodeKinds) {
		if (kind === "artifact") artifacts.push(id);
	}
	// Also include artifacts that only appear via edges (not in nodeKinds yet)
	for (const a of [...produced, ...consumed]) {
		if (!nodeKinds.has(a)) artifacts.push(a);
	}

	const terminals = [...new Set(artifacts)].filter(
		(a) =>
			produced.has(a) &&
			!consumed.has(a) &&
			!artifactMeta?.[a]?.externalStakeholders?.length,
	);
	const externalInputs = [...new Set(artifacts)].filter(
		(a) => consumed.has(a) && !produced.has(a),
	);

	return { terminals, externalInputs };
}
