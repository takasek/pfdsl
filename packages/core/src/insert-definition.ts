import { Document } from "yaml";
import {
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";

export interface InsertDefinitionResult {
	/**
	 * The frontmatter block (fenced `---`s included) after inserting the
	 * definition, or unchanged (the original block text) when `inserted` is
	 * false. `""` when the source had no frontmatter, or when its fences were
	 * well-formed but the YAML content didn't parse (FM002) — neither has
	 * anything safe to rewrite.
	 */
	output: string;
	inserted: boolean;
}

/**
 * Insert a `label: <id>` definition block for a node that appears only in
 * edges. Applied through the frontmatter yaml CST (ADR-0034), so unrelated
 * comments, quote style, and flow-vs-block choice survive untouched; a
 * no-op (and idempotent) when `id` is already defined under `kind`.
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
		// The fences are well-formed but the YAML content doesn't parse
		// (FM002) — `Document#toString()` throws on a Document carrying parse
		// errors, so there is nothing safe to insert into.
		return { output: "", inserted: false };
	}
	const doc = cst.present ? cst.doc : new Document();

	if (doc.hasIn([kind, id])) {
		return {
			output: cst.present
				? renderFrontmatterCst(doc, cst.newline, cst.yamlText)
				: "",
			inserted: false,
		};
	}

	doc.setIn([kind, id, "label"], id);
	return {
		output: renderFrontmatterCst(doc, cst.newline, cst.yamlText),
		inserted: true,
	};
}
