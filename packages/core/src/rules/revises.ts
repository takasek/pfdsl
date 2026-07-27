import { zeroRange } from "../position.js";
import type { Diagnostic } from "../types/index.js";
import type { RuleContext } from "./context.js";

/**
 * The `revises:` links that survived validation, as `artifact -> target`.
 * Entries rejected by V016/V017 are absent, so the later rules never see them.
 */
function collectRevises(ctx: RuleContext): {
	targets: Map<string, string>;
	diagnostics: Diagnostic[];
} {
	const targets = new Map<string, string>();
	const diagnostics: Diagnostic[] = [];

	for (const [aid, rawMeta] of Object.entries(ctx.artifactMeta)) {
		const target = (rawMeta as Record<string, unknown>).revises;
		if (target === undefined || target === null) continue;
		if (typeof target !== "string") {
			diagnostics.push({
				severity: "error",
				code: "V016",
				message: `'revises' on artifact '${aid}' must be a string, got ${typeof target}`,
				range: zeroRange(),
			});
			continue;
		}
		if (target === aid) {
			diagnostics.push({
				severity: "error",
				code: "V017",
				message: `Artifact '${aid}' revises itself`,
				range: zeroRange(),
			});
			continue;
		}
		if (ctx.artifactMeta[target] === undefined) {
			diagnostics.push({
				severity: "error",
				code: "V016",
				message: `'revises' target '${target}' of artifact '${aid}' not found in this file`,
				range: zeroRange(),
			});
			continue;
		}
		targets.set(aid, target);
	}

	return { targets, diagnostics };
}

/**
 * V016 – V019: the `revises:` chain (§15.9). A revision must point at an
 * artifact declared in the same file, not at itself; a given artifact may be
 * revised by at most one successor; and the chain must not close into a cycle.
 */
export function revisesChain(ctx: RuleContext): Diagnostic[] {
	const { targets, diagnostics } = collectRevises(ctx);

	// V018: two artifacts revising the same target fork the lineage.
	const revisedBy = new Map<string, string[]>();
	for (const [aid, target] of targets) {
		revisedBy.set(target, [...(revisedBy.get(target) ?? []), aid]);
	}
	for (const [target, revisors] of revisedBy) {
		if (revisors.length > 1) {
			diagnostics.push({
				severity: "error",
				code: "V018",
				message: `Artifact '${target}' is revised by multiple artifacts: ${revisors.join(", ")}`,
				range: zeroRange(),
			});
		}
	}

	// V019: one diagnostic per independent cycle (§16).
	const color = new Map<string, "white" | "gray" | "black">();
	for (const id of Object.keys(ctx.artifactMeta)) color.set(id, "white");
	function walk(id: string): boolean {
		if (color.get(id) === "gray") return true;
		if (color.get(id) === "black") return false;
		color.set(id, "gray");
		const target = targets.get(id);
		if (target !== undefined && walk(target)) {
			diagnostics.push({
				severity: "error",
				code: "V019",
				message: `Cycle detected in 'revises' chain involving '${id}'`,
				range: zeroRange(),
			});
			color.set(id, "black");
			return false;
		}
		color.set(id, "black");
		return false;
	}
	for (const id of Object.keys(ctx.artifactMeta)) {
		if (color.get(id) === "white") walk(id);
	}

	return diagnostics;
}
