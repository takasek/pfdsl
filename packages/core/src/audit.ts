import { computeOpenInputs } from "./multifile.js";
import type { ArtifactMeta } from "./types/frontmatter.js";
import type { NodeKind, NormalizedEdge } from "./types/index.js";

export interface ConsumerAsymmetryHint {
	/** The artifact whose consumer set is a proper subset of `sibling`'s */
	artifact: string;
	/** Processes present on `sibling` but missing on `artifact` */
	missingProcesses: string[];
	/** The same-group artifact that has the superset of consumers */
	sibling: string;
}

export interface AuditResult {
	/** Artifacts produced by a process but not consumed by any process */
	terminals: string[];
	/** Artifacts consumed by a process but not produced by any process */
	externalInputs: string[];
	/** Same-kind symmetry hints: artifact whose normal consumer set is a proper subset of a same-group sibling's */
	consumerAsymmetry: ConsumerAsymmetryHint[];
	/** Number of additional hints beyond the 10-hint cap */
	consumerAsymmetryRemainder: number;
}

/**
 * Inspect the primary graph for terminal artifacts and external inputs.
 *
 * `terminals` here is the spec's **audit-terminal** (§15.11): produced and
 * not consumed by a normal `>>` input, ignoring feedback (`>>?`) consumption.
 * This intentionally differs from `computeTerminals` in multifile.ts, which
 * computes the stricter **boundary-terminal** (also excludes artifacts
 * consumed only via feedback) used for subflow boundary validation. The two
 * terms are distinct by design — see spec §15.11 "audit-terminal と
 * boundary-terminal" — not a bug to converge.
 *
 * `externalInputs` delegates to `computeOpenInputs` (multifile.ts), which
 * implements the same "consumed by `>>`, not produced" check.
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
	const openInputs = computeOpenInputs(edges);
	const externalInputs = [...new Set(artifacts)].filter((a) =>
		openInputs.has(a),
	);

	// Consumer asymmetry: group artifacts by their frontmatter group, then
	// compare normal (non-feedback) consumer sets pairwise within each group.
	const consumerAsymmetry: ConsumerAsymmetryHint[] = [];
	let consumerAsymmetryRemainder = 0;

	if (artifactMeta) {
		// Build map: artifact id → set of consuming processes (input edges only)
		const normalConsumers = new Map<string, Set<string>>();
		for (const e of edges) {
			if (e.kind !== "input") continue;
			let set = normalConsumers.get(e.artifact);
			if (!set) {
				set = new Set();
				normalConsumers.set(e.artifact, set);
			}
			set.add(e.process);
		}

		// Group artifacts by their group, ignoring ungrouped artifacts
		const byGroup = new Map<string, string[]>();
		for (const [id, meta] of Object.entries(artifactMeta)) {
			const grp = meta.group;
			if (!grp) continue;
			// Only consider artifacts that have at least one outgoing normal edge
			if (!normalConsumers.has(id)) continue;
			let list = byGroup.get(grp);
			if (!list) {
				list = [];
				byGroup.set(grp, list);
			}
			list.push(id);
		}

		const allHints: ConsumerAsymmetryHint[] = [];
		for (const members of byGroup.values()) {
			if (members.length < 2) continue;
			// Pairwise: check if consumers(A) ⊂ consumers(B) strictly
			for (const a of members) {
				for (const b of members) {
					if (a === b) continue;
					const consA = normalConsumers.get(a) ?? new Set<string>();
					const consB = normalConsumers.get(b) ?? new Set<string>();
					// Check A ⊂ B strictly: every element of A is in B, and B has more
					if (consA.size >= consB.size) continue;
					const isSubset = [...consA].every((p) => consB.has(p));
					if (!isSubset) continue;
					const missing = [...consB].filter((p) => !consA.has(p)).sort();
					allHints.push({ artifact: a, missingProcesses: missing, sibling: b });
				}
			}
		}

		const CAP = 10;
		if (allHints.length > CAP) {
			consumerAsymmetryRemainder = allHints.length - CAP;
			consumerAsymmetry.push(...allHints.slice(0, CAP));
		} else {
			consumerAsymmetry.push(...allHints);
		}
	}

	return {
		terminals,
		externalInputs,
		consumerAsymmetry,
		consumerAsymmetryRemainder,
	};
}
