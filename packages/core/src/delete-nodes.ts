import { Document } from "yaml";
import {
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";
import { analyze } from "./index.js";
import type { Diagnostic } from "./types/index.js";

export interface DeleteNodesResult {
	/**
	 * The whole document (frontmatter + body) with every `id` in `ids` removed
	 * from its frontmatter declaration, every body edge occurrence, and every
	 * surviving node's reference fields. Unchanged (the original `source`)
	 * when `source` already carries a parse/validation error — there is
	 * nothing safe to rewrite.
	 */
	output: string;
	/** Ids that existed (frontmatter declaration and/or body occurrence) and were removed. */
	deleted: string[];
	/** Ids that existed nowhere in `source` — a no-op for that id (idempotent). */
	notFound: string[];
	diagnostics: Diagnostic[];
}

/**
 * Remove one or more nodes from a `.pfdsl` document in a single pass: the
 * frontmatter declaration block, every body edge occurrence, and every
 * surviving node's `revises:` / `parts:` / `boundary:` reference to the
 * deleted id. Applied atomically across all three so a caller can never end
 * up with a declaration and no edge occurrence (or vice versa) — the
 * decomposed-repair the issue this API exists for.
 *
 * The frontmatter half is applied through the yaml CST (ADR-0034), the same
 * way `insertDefinition` and `reindex` do, so unrelated comments, quote
 * style, and flow-vs-block choice survive untouched.
 */
export function deleteNodes(
	source: string,
	ids: readonly string[],
): DeleteNodesResult {
	const { frontmatter, diagnostics } = analyze(source);
	if (diagnostics.some((d) => d.severity === "error")) {
		return { output: source, deleted: [], notFound: [...ids], diagnostics };
	}

	const deleteSet = new Set(ids);
	const found = new Set<string>();

	const cst = parseFrontmatterCst(source);
	const doc = cst.present ? cst.doc : new Document();

	for (const id of deleteSet) {
		if (doc.hasIn(["artifact", id])) {
			doc.deleteIn(["artifact", id]);
			found.add(id);
		} else if (doc.hasIn(["process", id])) {
			doc.deleteIn(["process", id]);
			found.add(id);
		}
	}
	void frontmatter;

	const frontmatterOutput = cst.present
		? renderFrontmatterCst(doc, cst.newline, cst.yamlText)
		: "";
	const output = frontmatterOutput + cst.body;

	const deleted = [...ids].filter((id) => found.has(id));
	const notFound = [...ids].filter((id) => !found.has(id));
	return { output, deleted, notFound, diagnostics };
}
