import { zeroRange } from "../position.js";
import type { Diagnostic } from "../types/index.js";
import { STATUS_VALUES } from "../types/index.js";
import type { RuleContext } from "./context.js";

const STATUS_SET: ReadonlySet<string> = new Set(STATUS_VALUES);

/**
 * V004 / V005 / W001: what a `parts:` list may name (§15.5).
 * A member must be an artifact, must not be the owner itself, and should take
 * part in at least one edge — otherwise it is declared but never produced.
 *
 * V007 rides along on the same pass so the diagnostic order per artifact
 * matches the order the fields are declared in.
 */
export function partsMembership(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const [artifactId, meta] of Object.entries(ctx.artifactMeta)) {
		for (const partId of meta.parts ?? []) {
			if (ctx.nodeKinds.get(partId) === "process") {
				diagnostics.push({
					severity: "error",
					code: "V004",
					message: `Parts member '${partId}' of '${artifactId}' is a process`,
					range: zeroRange(),
				});
			}
			if (partId === artifactId) {
				diagnostics.push({
					severity: "error",
					code: "V005",
					message: `'${artifactId}' cannot include itself in parts`,
					range: zeroRange(),
				});
			}
			if (
				!ctx.nodesWithEdges.has(partId) &&
				ctx.nodeKinds.get(partId) !== "process"
			) {
				diagnostics.push({
					severity: "warning",
					code: "W001",
					message: `Parts member '${partId}' of '${artifactId}' has no edges`,
					range: zeroRange(),
				});
			}
		}
		if (meta.status !== undefined && !STATUS_SET.has(meta.status)) {
			diagnostics.push({
				severity: "error",
				code: "V007",
				message: `Invalid status '${meta.status}' on artifact '${artifactId}'. Allowed: ${STATUS_VALUES.join(", ")}`,
				range: zeroRange(),
			});
		}
	}
	return diagnostics;
}

/** V006: `parts:` must not form a cycle (§15.5). One diagnostic per cycle (§16). */
export function partsCycle(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const visited = new Set<string>();
	const inStack = new Set<string>();
	const path: string[] = [];

	function walk(id: string): void {
		if (inStack.has(id)) {
			diagnostics.push({
				severity: "error",
				code: "V006",
				message: `Cycle in parts: ${[...path, id].join(" → ")}`,
				range: zeroRange(),
			});
			return;
		}
		if (visited.has(id)) return;
		visited.add(id);
		inStack.add(id);
		path.push(id);
		for (const part of ctx.artifactMeta[id]?.parts ?? []) walk(part);
		path.pop();
		inStack.delete(id);
	}

	for (const id of Object.keys(ctx.artifactMeta)) walk(id);
	return diagnostics;
}
