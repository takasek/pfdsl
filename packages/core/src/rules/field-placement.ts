import { zeroRange } from "../position.js";
import type { Diagnostic } from "../types/index.js";
import type { RuleContext } from "./context.js";

/**
 * V012 / V015: fields that belong to an artifact, rejected on a process
 * (§15.7, §15.9). `location:` is deliberately absent — it is legal on both
 * since #310.
 */
export function processOnlyFields(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const [pid, rawMeta] of Object.entries(ctx.processMeta)) {
		const meta = rawMeta as Record<string, unknown>;
		if (meta.criteria !== undefined) {
			diagnostics.push({
				severity: "error",
				code: "V012",
				message: `'criteria' is not allowed on process '${pid}'`,
				range: zeroRange(),
			});
		}
		if (meta.revises !== undefined) {
			diagnostics.push({
				severity: "error",
				code: "V015",
				message: `'revises' is not allowed on process '${pid}'`,
				range: zeroRange(),
			});
		}
	}
	return diagnostics;
}

/**
 * W002 / V014: a produced artifact should say how it is judged done (§15.7),
 * and `command:` belongs to the process that makes it, not to the artifact
 * (§15.8).
 *
 * W002 applies only to produced artifacts: a source artifact has no process to
 * attach a completion criterion to.
 */
export function artifactOnlyFields(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const [aid, rawMeta] of Object.entries(ctx.artifactMeta)) {
		const meta = rawMeta as Record<string, unknown>;
		if (
			meta.criteria === undefined &&
			ctx.edgeGroups.artifactProducers.has(aid)
		) {
			diagnostics.push({
				severity: ctx.strictly("warning"),
				code: "W002",
				message: `Artifact '${aid}' has no 'criteria' field`,
				range: ctx.rangeOf(aid),
			});
		}
		if (meta.command !== undefined) {
			diagnostics.push({
				severity: "error",
				code: "V014",
				message: `'command' is not allowed on artifact '${aid}'`,
				range: zeroRange(),
			});
		}
	}
	return diagnostics;
}

/** V023: `subflow:` names a child graph for a process, never for an artifact (§15.11). */
export function subflowOnArtifact(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const [id, rawMeta] of Object.entries(ctx.artifactMeta)) {
		if ((rawMeta as Record<string, unknown>).subflow !== undefined) {
			diagnostics.push({
				severity: "error",
				code: "V023",
				message: `'subflow' is not allowed on artifact '${id}'`,
				range: zeroRange(),
			});
		}
	}
	return diagnostics;
}

/** V024: `boundary:` remaps a subflow's ids, so it needs one to remap (§15.11). */
export function boundaryWithoutSubflow(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const [pid, rawMeta] of Object.entries(ctx.processMeta)) {
		const meta = rawMeta as Record<string, unknown>;
		if (meta.boundary !== undefined && meta.subflow === undefined) {
			diagnostics.push({
				severity: "error",
				code: "V024",
				message: `'boundary' on process '${pid}' requires 'subflow'`,
				range: zeroRange(),
			});
		}
	}
	return diagnostics;
}
