import { Document } from "yaml";
import {
	applySplices,
	newEntrySplice,
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";

export interface InsertDefinitionResult {
	output: string;
	inserted: boolean;
}

/**
 * Insert a `label: <id>` definition block for a node that appears only in
 * edges. Splices the new entry's text directly into the source via
 * `newEntrySplice` (ADR-0034 / frontmatter-cst-splice-design): unrelated
 * comments, quote style, flow-vs-block choice, and indentation all survive
 * byte-for-byte — a no-op (and idempotent) when `id` is already defined
 * under `kind`.
 *
 * Returns only the frontmatter block's text, not the whole document —
 * callers (e.g. the VS Code extension's code action) apply it by replacing
 * the document's existing frontmatter range, or inserting it fresh at the
 * top of the file when there was none.
 */
export function insertDefinition(
	source: string,
	kind: "artifact" | "process",
	id: string,
): InsertDefinitionResult {
	const cst = parseFrontmatterCst(source);
	if (cst.present && cst.doc.errors.length > 0) {
		return { output: "", inserted: false };
	}
	if (!cst.present) {
		const doc = new Document();
		doc.setIn([kind, id, "label"], id);
		return { output: renderFrontmatterCst(doc, cst.newline), inserted: true };
	}

	const { doc, yamlText, newline } = cst;
	if (doc.hasIn([kind, id])) {
		return { output: renderFrontmatterCst(doc, newline), inserted: false };
	}

	const result = newEntrySplice(yamlText, doc, kind, id, "label", id, newline);
	if (!result.ok) {
		// Empty block-style kind section, or an entirely empty document body
		// with no other top-level key to anchor on — no sibling text to
		// preserve either way, so a full re-serialize is safe here.
		doc.setIn([kind, id, "label"], id);
		return { output: renderFrontmatterCst(doc, newline), inserted: true };
	}

	const newYamlText = applySplices(yamlText, [result.splice]);
	return {
		output: `---${newline}${newYamlText}${newline}---${newline}`,
		inserted: true,
	};
}
