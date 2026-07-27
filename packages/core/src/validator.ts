import {
	orphanedProcess,
	processCompleteness,
	singleSource,
} from "./rules/completeness.js";
import {
	buildRuleContext,
	type Rule,
	type ValidateOptions,
} from "./rules/context.js";
import {
	groupParentCycle,
	primaryGraphCycle,
	strictFeedback,
} from "./rules/cycles.js";
import {
	artifactOnlyFields,
	boundaryWithoutSubflow,
	processOnlyFields,
	subflowOnArtifact,
} from "./rules/field-placement.js";
import { indexShape, styleShape } from "./rules/metadata-shape.js";
import { partsCycle, partsMembership } from "./rules/parts.js";
import { revisesChain } from "./rules/revises.js";
import {
	pfdType,
	readyGateTypeOmitted,
	roadmapStatusPresence,
	statusMonotonicity,
} from "./rules/status.js";
import type {
	Diagnostic,
	Frontmatter,
	NodeKind,
	NormalizedEdge,
} from "./types/index.js";

export type { Rule, RuleContext, ValidateOptions } from "./rules/context.js";

/**
 * Every rule the checker applies, in the order their diagnostics are reported.
 * The order is part of the CLI's output, so entries move only deliberately.
 */
export const RULES: readonly Rule[] = [
	singleSource, // V001
	processCompleteness, // V002, V003
	orphanedProcess, // V020
	partsMembership, // V004, V005, V007, W001
	indexShape, // V029, W004
	styleShape, // V008, V009
	partsCycle, // V006
	primaryGraphCycle, // V010
	strictFeedback, // V011
	processOnlyFields, // V012, V015
	artifactOnlyFields, // V014, W002
	revisesChain, // V016, V017, V018, V019
	statusMonotonicity, // W003
	subflowOnArtifact, // V023
	boundaryWithoutSubflow, // V024
	groupParentCycle, // V025
	roadmapStatusPresence, // W005
	pfdType, // V031
	readyGateTypeOmitted, // W006
];

export function validate(
	edges: NormalizedEdge[],
	nodeKinds: Map<string, NodeKind>,
	fm: Frontmatter | null,
	options?: ValidateOptions,
): Diagnostic[] {
	const ctx = buildRuleContext(edges, nodeKinds, fm, options ?? {});
	return RULES.flatMap((rule) => rule(ctx));
}
