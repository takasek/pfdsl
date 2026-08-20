import { zeroRange } from "../position.js";
import type { Diagnostic } from "../types/index.js";
import type { RuleContext } from "./context.js";

/**
 * V010: the primary graph must be acyclic (§16). Feedback edges are exempt —
 * looping an artifact back into an earlier process is what they are for.
 *
 * One diagnostic per back edge, since a back edge is exactly what closes a
 * cycle: disjoint cycles are reported separately rather than the first one
 * masking the rest.
 */
export function primaryGraphCycle(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const color = new Map<string, "white" | "gray" | "black">();
	const allNodes = new Set<string>();
	for (const e of ctx.edges) {
		if (e.kind !== "feedback") {
			allNodes.add(e.kind === "output" ? e.process : e.artifact);
			allNodes.add(e.kind === "output" ? e.artifact : e.process);
		}
	}
	for (const n of allNodes) color.set(n, "white");

	function walk(id: string): void {
		color.set(id, "gray");
		for (const neighbor of ctx.primaryAdj.get(id) ?? []) {
			const neighborColor = color.get(neighbor);
			if (neighborColor === "gray") {
				diagnostics.push({
					severity: "error",
					code: "V010",
					message: `Primary graph contains a cycle involving '${id}' → '${neighbor}'`,
					range: zeroRange(),
				});
			} else if (neighborColor !== "black") {
				walk(neighbor);
			}
		}
		color.set(id, "black");
	}

	for (const n of allNodes) {
		if (color.get(n) === "white") walk(n);
	}
	return diagnostics;
}

/**
 * V011: under --strict, a feedback edge `A >>? P` is a reverse cycle when A can
 * already reach P through ordinary edges (§15.3). A feedback artifact from an
 * unrelated subgraph is legitimate and stays silent.
 */
export function strictFeedback(ctx: RuleContext): Diagnostic[] {
	if (!ctx.options.strict) return [];
	const diagnostics: Diagnostic[] = [];

	const reachableFrom = (start: string): Set<string> => {
		const reachable = new Set<string>();
		const queue: string[] = [start];
		while (queue.length > 0) {
			const node = queue.shift()!;
			for (const neighbor of ctx.primaryAdj.get(node) ?? []) {
				if (!reachable.has(neighbor)) {
					reachable.add(neighbor);
					queue.push(neighbor);
				}
			}
		}
		return reachable;
	};

	for (const e of ctx.edges) {
		if (e.kind !== "feedback") continue;
		if (reachableFrom(e.artifact).has(e.process)) {
			diagnostics.push({
				severity: "error",
				code: "V011",
				message: `Feedback artifact '${e.artifact}' is already an upstream ancestor of process '${e.process}' in the primary graph (reverse cycle)`,
				range: zeroRange(),
			});
		}
	}
	return diagnostics;
}

/** V025: a group's `parent:` chain must not close on itself (§2.8.4). */
export function groupParentCycle(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const groupMeta = ctx.fm?.group ?? {};
	const color = new Map<string, "white" | "gray" | "black">();
	for (const id of Object.keys(groupMeta)) color.set(id, "white");

	function walk(id: string): boolean {
		color.set(id, "gray");
		const parent = groupMeta[id]?.parent;
		if (parent !== undefined) {
			if (color.get(parent) === "gray") {
				diagnostics.push({
					severity: "error",
					code: "V025",
					message: `Cycle detected in 'parent' chain involving group '${id}' → '${parent}'`,
					range: zeroRange(),
				});
				color.set(id, "black");
				return true;
			}
			if (color.get(parent) === "white" && walk(parent)) {
				color.set(id, "black");
				return true;
			}
		}
		color.set(id, "black");
		return false;
	}

	for (const id of Object.keys(groupMeta)) {
		if (color.get(id) === "white") walk(id);
	}
	return diagnostics;
}
