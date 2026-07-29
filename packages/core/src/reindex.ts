import { Document } from "yaml";
import {
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";
import { analyze } from "./index.js";
import { computeTopoOrder } from "./sorter.js";
import type { Diagnostic, NodeKind } from "./types/index.js";

export interface IndexChange {
	kind: NodeKind;
	id: string;
	/** Existing index, or null when the node had none. */
	from: number | null;
	to: number;
}

export interface ReindexResult {
	/** Source with index: assignments applied (unchanged on error). */
	output: string;
	/** Nodes whose index was assigned or changed (unchanged ones omitted). */
	changes: IndexChange[];
	diagnostics: Diagnostic[];
}

export interface ReindexOptions {
	/** Reassign every node from 1 (default: keep existing, fill only gaps). */
	renumber?: boolean;
}

/**
 * Assign integer `index:` values to nodes in topological order, with
 * independent counters for processes and artifacts. Default mode fills only
 * nodes lacking an index; `renumber` reassigns all from 1. Edits are applied
 * through the frontmatter yaml CST (ADR-0034), so comments, quote style, and
 * flow-vs-block choice survive untouched.
 */
export function reindex(
	source: string,
	opts: ReindexOptions = {},
): ReindexResult {
	const { edges, graph, nodeKinds, frontmatter, diagnostics } = analyze(source);
	if (diagnostics.some((d) => d.severity === "error")) {
		return { output: source, changes: [], diagnostics };
	}

	// nodeKinds is total over every candidate id (the normalizer registers all
	// frontmatter artifact:/process: keys); the default is a safety net only.
	const kindOf = (id: string): NodeKind => nodeKinds.get(id) ?? "artifact";
	const existingIndex = (id: string): number | undefined => {
		const meta =
			kindOf(id) === "process"
				? frontmatter?.process?.[id]
				: frontmatter?.artifact?.[id];
		return typeof meta?.index === "number" ? meta.index : undefined;
	};

	const order = computeTopoOrder(edges, graph, frontmatter);

	// Assign indices per kind.
	const assigned = new Map<string, number>();
	if (opts.renumber) {
		const counter: Record<NodeKind, number> = {
			artifact: 0,
			process: 0,
			group: 0,
		};
		for (const id of order) {
			const kind = kindOf(id);
			counter[kind] += 1;
			assigned.set(id, counter[kind]);
		}
	} else {
		// fill: keep existing, hand out numbers above the current max per kind.
		const next: Record<NodeKind, number> = {
			artifact: 0,
			process: 0,
			group: 0,
		};
		for (const id of order) {
			const cur = existingIndex(id);
			if (cur !== undefined) next[kindOf(id)] = Math.max(next[kindOf(id)], cur);
		}
		for (const id of order) {
			const cur = existingIndex(id);
			if (cur !== undefined) {
				assigned.set(id, cur);
				continue;
			}
			const kind = kindOf(id);
			next[kind] += 1;
			assigned.set(id, next[kind]);
		}
	}

	// Diff against existing to build the change list.
	const changes: IndexChange[] = [];
	for (const id of order) {
		const to = assigned.get(id)!;
		const from = existingIndex(id) ?? null;
		if (from === to) continue;
		changes.push({ kind: kindOf(id), id, from, to });
	}

	if (!changes.length) return { output: source, changes, diagnostics };

	const cst = parseFrontmatterCst(source);
	const doc = cst.present ? cst.doc : new Document();
	for (const c of changes) {
		doc.setIn([c.kind, c.id, "index"], c.to);
	}
	const output = renderFrontmatterCst(doc, cst.newline) + cst.body;
	return { output, changes, diagnostics };
}
