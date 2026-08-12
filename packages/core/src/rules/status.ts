import { zeroRange } from "../position.js";
import type { Diagnostic } from "../types/index.js";
import { isRoadmapType, PFD_TYPE_VALUES } from "../types/index.js";
import type { RuleContext } from "./context.js";

const PFD_TYPE_SET: ReadonlySet<string> = new Set(PFD_TYPE_VALUES);

/**
 * W003: status must not run backwards along an edge (§15.6). If a process
 * produces something `done`, an input it consumed cannot still be unfinished.
 * Only inputs with a declared status count — an undeclared one states nothing.
 * Feedback inputs are exempt: they close a loop rather than feed the output.
 */
export function statusMonotonicity(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const { processInputs, processOutputs } = ctx.edgeGroups;
	for (const [pid, outputs] of processOutputs) {
		const producesDone = outputs.some(
			(aid) => ctx.artifactMeta[aid]?.status === "done",
		);
		if (!producesDone) continue;
		for (const aid of processInputs.get(pid) ?? []) {
			const status = ctx.artifactMeta[aid]?.status;
			if (status !== undefined && status !== "done") {
				diagnostics.push({
					severity: "warning",
					code: "W003",
					message: `Process '${pid}' outputs a 'done' artifact but input '${aid}' has status '${status}'`,
					range: zeroRange(),
				});
			}
		}
	}
	return diagnostics;
}

/**
 * W005: in a roadmap, a produced artifact carries the progress, so it needs a
 * status to carry (§15.15). Source artifacts and non-roadmap files are exempt.
 */
export function roadmapStatusPresence(ctx: RuleContext): Diagnostic[] {
	if (ctx.fm?.type !== "roadmap") return [];
	const diagnostics: Diagnostic[] = [];
	for (const [aid] of ctx.edgeGroups.artifactProducers) {
		if (ctx.artifactMeta[aid]?.status === undefined) {
			diagnostics.push({
				severity: ctx.strictly("warning"),
				code: "W005",
				message: `Produced artifact '${aid}' has no 'status' field`,
				range: ctx.rangeOf(aid),
			});
		}
	}
	return diagnostics;
}

/**
 * W007: outside a roadmap, an artifact carries no progress of its own (§15.16).
 * The same id can appear in several diagrams, so status lives in one of them —
 * a flow file that declares it lets two diagrams claim different states for the
 * same thing. Mirror of W005, which exempts files with no `type:` for the same
 * reason this one does: an omitted kind declares nothing to hold them to.
 */
export function flowStatusAbsence(ctx: RuleContext): Diagnostic[] {
	const type = ctx.fm?.type;
	if (isRoadmapType(type)) return [];
	const diagnostics: Diagnostic[] = [];
	for (const [aid, meta] of Object.entries(ctx.artifactMeta)) {
		if (meta?.status === undefined) continue;
		diagnostics.push({
			severity: ctx.strictly("warning"),
			code: "W007",
			message: `Artifact '${aid}' has 'status' set in a '${type}' file; status belongs to the roadmap`,
			range: ctx.rangeOf(aid),
		});
	}
	return diagnostics;
}

/** V031: `type:` must name a known PFD kind (§15.14). */
export function pfdType(ctx: RuleContext): Diagnostic[] {
	const type = ctx.fm?.type;
	if (type === undefined || PFD_TYPE_SET.has(String(type))) return [];
	return [
		{
			severity: "error",
			code: "V031",
			message: `Invalid type '${String(type)}'. Allowed: ${PFD_TYPE_VALUES.join(", ")}`,
			range: zeroRange(),
		},
	];
}

/**
 * W006: the ready gate treats a file with no `type:` as a roadmap (§15.14).
 * Say so, rather than acting on an assumption the author never wrote down.
 */
export function readyGateTypeOmitted(ctx: RuleContext): Diagnostic[] {
	if (!ctx.options.readyGate || ctx.fm?.type !== undefined) return [];
	return [
		{
			severity: "warning",
			code: "W006",
			message:
				"type: omitted; treating this file as 'roadmap' for ready gating. Add 'type: roadmap' to make this explicit.",
			range: zeroRange(),
		},
	];
}
