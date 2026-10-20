import type { Diagnostic, NormalizedEdge } from "../types/index.js";
import type { RuleContext } from "./context.js";

interface ArtifactProcessPair {
	artifact: string;
	process: string;
}

function pairKey(artifact: string, process: string): string {
	return JSON.stringify([artifact, process]);
}

/** Pairs represented as both a normal input and feedback edge. */
export function inputFeedbackConflictPairs(
	edges: readonly NormalizedEdge[],
): ArtifactProcessPair[] {
	const inputs = new Set<string>();
	const feedback = new Map<string, ArtifactProcessPair>();
	for (const edge of edges) {
		if (edge.kind === "input") {
			inputs.add(pairKey(edge.artifact, edge.process));
		} else if (edge.kind === "feedback") {
			feedback.set(pairKey(edge.artifact, edge.process), {
				artifact: edge.artifact,
				process: edge.process,
			});
		}
	}
	return [...feedback.entries()]
		.filter(([key]) => inputs.has(key))
		.map(([, pair]) => pair)
		.sort(
			(left, right) =>
				left.artifact.localeCompare(right.artifact) ||
				left.process.localeCompare(right.process),
		);
}

/** V036: one artifact-process pair cannot be both a normal input and feedback. */
export function inputFeedbackConflict(ctx: RuleContext): Diagnostic[] {
	return inputFeedbackConflictPairs(ctx.edges).map(({ artifact, process }) => ({
		severity: "error",
		code: "V036",
		message: `Artifact '${artifact}' is connected to process '${process}' both as an input (>>) and as feedback (>>?); keep only one connection`,
		range: ctx.edgeRange({ kind: "feedback", artifact, process }),
	}));
}
