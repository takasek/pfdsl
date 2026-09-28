import { Document, isMap, isScalar, isSeq } from "yaml";
import { formatIdBefore } from "./formatter.js";
import {
	declarationPair,
	pairId,
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";
import type { AnalyzeResult } from "./index.js";
import { lex } from "./lexer.js";
import { parentBoundaryArtifacts } from "./multifile.js";

/**
 * Rewrite artifact or process id `oldId` (of kind `kind`, resolved by
 * `rename`) to `newId` in `source`, returning the whole document: its
 * frontmatter declaration key, every other artifact's `revises:` / `parts:`
 * reference, every process's `boundary:` key naming it, every body token
 * equal to it, and — when `oldId` is a normal input/output of a subflow
 * process whose `boundary:` does not already map it — a new
 * `boundary: { <newId>: <oldId> }` entry. `boundary:` values are the child
 * file's own ids and are never touched.
 *
 * The frontmatter half goes through the yaml CST (ADR-0034), so comments,
 * quote style and flow-vs-block choice elsewhere survive. The body half is a
 * lexer-token splice: every byte outside a matched `ID` token's span —
 * operators, brackets, comments, continuation lines — is copied through.
 */
export function renameId(
	source: string,
	analysis: Pick<AnalyzeResult, "frontmatter" | "edges">,
	oldId: string,
	newId: string,
	kind: "artifact" | "process",
): string {
	const { frontmatter, edges } = analysis;
	const cst = parseFrontmatterCst(source);
	const doc = cst.present ? cst.doc : new Document();

	// Declaration keys and revises:/parts: values are YAML strings in any
	// readable document (a typed one is FM004, which `rename` refuses).
	const pair = declarationPair(doc, oldId, kind);
	if (pair && isScalar(pair.key)) pair.key.value = newId;

	// Other artifacts' revises:/parts: references.
	for (const [aid, meta] of Object.entries(frontmatter?.artifact ?? {})) {
		if (aid === oldId) continue;
		if (meta?.revises === oldId) {
			doc.setIn(["artifact", aid, "revises"], newId);
		}
		if (Array.isArray(meta?.parts)) {
			const partsNode = doc.getIn(["artifact", aid, "parts"], true);
			if (isSeq(partsNode)) {
				for (const item of partsNode.items) {
					if (isScalar(item) && item.value === oldId) item.value = newId;
				}
			}
		}
	}

	// Each process's boundary: map. A KEY naming `oldId` is renamed; values
	// are the child file's own ids and are never touched. Otherwise, when
	// `oldId` is a normal input/output of a subflow process, a
	// `{ <newId>: <oldId> }` entry is added: an unmapped boundary artifact is
	// matched to the child by identical id (spec §2.9.3), and the entry keeps
	// that match after the rename.
	for (const [pid, meta] of Object.entries(frontmatter?.process ?? {})) {
		const boundaryNode = doc.getIn(["process", pid, "boundary"], true);
		let mapped = false;
		if (isMap(boundaryNode)) {
			for (const pair of boundaryNode.items) {
				// boundary: keys are not restricted to YAML strings; `pairId` reads a
				// bare `10:` by its string form, so it matches `oldId` "10".
				if (pairId(pair) === oldId && isScalar(pair.key)) {
					pair.key.value = newId;
					mapped = true;
				}
			}
		}
		if (mapped || typeof meta?.subflow !== "string") continue;
		const { inputs, outputs } = parentBoundaryArtifacts(edges, pid);
		if (!inputs.has(oldId) && !outputs.has(oldId)) continue;
		if (isMap(boundaryNode)) {
			doc.setIn(["process", pid, "boundary", newId], oldId);
		} else {
			doc.setIn(["process", pid, "boundary"], { [newId]: oldId });
		}
	}

	const frontmatterOutput = cst.present
		? renderFrontmatterCst(doc, cst.newline, cst.yamlText)
		: "";

	const { tokens } = lex(cst.body);
	let bodyOutput = "";
	let cursor = 0;
	for (const t of tokens) {
		if (t.type === "ID" && t.value === oldId) {
			bodyOutput += cst.body.slice(cursor, t.start.offset);
			bodyOutput += formatIdBefore(newId, cst.body[t.end.offset]);
			cursor = t.end.offset;
		}
	}
	bodyOutput += cst.body.slice(cursor);

	return frontmatterOutput + bodyOutput;
}
