import { Document, parseDocument } from "yaml";
import {
	applySplices,
	fieldValueSplice,
	newEntrySplice,
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
	if (!cst.present) {
		// No frontmatter to splice into (shouldn't happen once `changes` is
		// non-empty, since every changed id came from parsed frontmatter, but
		// keep the pre-existing full-render fallback for safety).
		const doc = new Document();
		for (const c of changes) doc.setIn([c.kind, c.id, "index"], c.to);
		return {
			output: renderFrontmatterCst(doc, cst.newline) + cst.body,
			changes,
			diagnostics,
		};
	}

	// Splices are computed and applied one at a time, re-parsing the
	// (possibly already-edited-by-a-prior-iteration) yaml text fresh before
	// each one. Batching all splices against a single snapshot and applying
	// them together is unsafe: independent structural insertions (e.g. "create
	// process:" and "append to artifact:") can resolve to the exact same byte
	// offset when the node they both anchor on is the last thing in the file
	// — `applySplices`'s overlap check doesn't flag same-offset zero-width
	// insertions, so it just concatenates their replacement texts in
	// whatever order the stable sort produced, with no awareness that they
	// belong under different parents. Sequential apply-and-reparse mirrors
	// the pattern already proven correct by `setFrontmatterField` /
	// `insertDefinition`, which only ever compute and apply one splice.
	let currentYamlText = cst.yamlText;
	let fallbackNeeded = false;
	for (const c of changes) {
		const currentDoc = parseDocument(currentYamlText);
		// A "group"-kind id is always already defined under ["group", id] in
		// frontmatter (that's how the normalizer classified it as "group" in
		// the first place), so `hasIn` is always true for it and it always
		// routes to fieldValueSplice — never to the newEntrySplice branch
		// below, where the narrowing cast lives. The cast is only ever
		// evaluated for "artifact"/"process" in practice; it exists purely so
		// TypeScript accepts c.kind (typed as the full NodeKind) as the
		// narrower "artifact" | "process" newEntrySplice expects.
		const kind = c.kind as "artifact" | "process";
		const result = currentDoc.hasIn([c.kind, c.id])
			? fieldValueSplice(
					currentYamlText,
					currentDoc,
					c.kind,
					c.id,
					"index",
					c.to,
					cst.newline,
				)
			: newEntrySplice(
					currentYamlText,
					currentDoc,
					kind,
					c.id,
					"index",
					c.to,
					cst.newline,
				);
		if (!result.ok) {
			fallbackNeeded = true;
			break;
		}
		currentYamlText = applySplices(currentYamlText, [result.splice]);
	}

	if (fallbackNeeded) {
		// Full re-serialize fallback operates on the original cst.doc, not the
		// partially-mutated currentYamlText above.
		for (const c of changes) cst.doc.setIn([c.kind, c.id, "index"], c.to);
		return {
			output: renderFrontmatterCst(cst.doc, cst.newline) + cst.body,
			changes,
			diagnostics,
		};
	}

	const output = `---${cst.newline}${currentYamlText}${cst.newline}---${cst.newline}${cst.body}`;
	return { output, changes, diagnostics };
}
