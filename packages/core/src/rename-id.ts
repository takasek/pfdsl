import { Document, isMap, isScalar, isSeq } from "yaml";
import { formatId } from "./formatter.js";
import {
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";
import { analyze } from "./index.js";
import { lex } from "./lexer.js";
import type { Diagnostic } from "./types/index.js";

/**
 * True when `diagnostics` report a document that could not be read —
 * frontmatter (FM), lexer (L), or parser (P) — so there is no trustworthy
 * structure to rewrite. A validation (V/W) or normalizer (N) error does not
 * count: the rename is still performed and the caller judges the result
 * (the top-level `rename` command refuses to emit a result that has errors).
 */
export function hasUnreadableError(
	diagnostics: readonly Diagnostic[],
): boolean {
	return diagnostics.some(
		(d) => d.severity === "error" && /^(?:FM|L|P)\d+$/.test(String(d.code)),
	);
}

export interface RenameIdResult {
	/**
	 * The whole document (frontmatter + body) with `oldId` renamed to `newId`
	 * everywhere it is this file's own id: its frontmatter declaration key (if
	 * declared), every other artifact's `revises:` value and `parts:` item
	 * that named it, every process's `boundary:` KEY that named it, and every
	 * body edge token equal to it. `boundary:` VALUES are the child file's own
	 * ids and are never touched. Unchanged (the original `source`) when
	 * `oldId` is not this file's own artifact/process id (frontmatter
	 * declaration or body-inferred node — nodeKinds from analyze()), or when
	 * `source` could not be read (see `hasUnreadableError`).
	 */
	output: string;
	/** True when `oldId` existed as an artifact/process id (declared or body-only) and was renamed. */
	found: boolean;
	/** The resolved kind of `oldId`, or null when not found / not an artifact-or-process id (e.g. a group id — the caller routes those to `renameGroup`). */
	kind: "artifact" | "process" | null;
	diagnostics: Diagnostic[];
}

/**
 * Rename an artifact or process id in one atomic in-place rewrite (issue
 * #1218): its frontmatter declaration key, every other node's `revises:` /
 * `parts:` reference, every subflow process's `boundary:` key, every body
 * edge occurrence, and — when `oldId` is an artifact adjacent (input or
 * output) to a subflow process whose `boundary:` does not already map it —
 * a new `boundary: { <newId>: <oldId> }` entry, so the child file's
 * unchanged boundary id set still matches after the rename (spec §2.9.3: an
 * unmapped boundary artifact is matched to the child by identical id).
 *
 * Kind resolution and every refusal (ambiguous id, `<new>` collision, `<old>`
 * not found, `<old>` === `<new>`) are the CLI layer's job (the top-level
 * `rename` command), not this function's — it always performs the rename it
 * is asked for when `oldId` resolves to an artifact or process id, and
 * reports a no-op (`found: false`) otherwise.
 *
 * The frontmatter half is applied through the yaml CST (ADR-0034), the same
 * way `renameGroup` and `deleteNodes` are — comments, quote style, and
 * flow-vs-block choice elsewhere in the frontmatter survive untouched. The
 * body half is a plain lexer-token splice (not the statement-level rebuild
 * `deleteNodes` needs for its drop/keep/replace planning): nothing is being
 * removed, so every byte outside a matched `ID` token's own span — operators,
 * brackets, comments, continuation lines, `>>?` — is copied through
 * unchanged.
 */
export function renameId(
	source: string,
	oldId: string,
	newId: string,
): RenameIdResult {
	const { diagnostics, frontmatter, edges, nodeKinds } = analyze(source);
	const noop: RenameIdResult = {
		output: source,
		found: false,
		kind: null,
		diagnostics,
	};
	if (hasUnreadableError(diagnostics)) return noop;

	const kind = nodeKinds.get(oldId);
	if (kind !== "artifact" && kind !== "process") return noop;

	const cst = parseFrontmatterCst(source);
	const doc = cst.present ? cst.doc : new Document();

	const matchesOldId = (value: unknown): boolean =>
		value !== undefined && String(value) === oldId;

	// Declaration key, in the section matching the resolved kind — see
	// rename-group.ts's `matchesOldId` for why the match goes through
	// `String(value)` rather than `===`.
	let declared = false;
	const sectionMap = doc.getIn([kind], true);
	if (isMap(sectionMap)) {
		const pair = sectionMap.items.find(
			(p) => isScalar(p.key) && matchesOldId(p.key.value),
		);
		if (pair && isScalar(pair.key)) {
			pair.key.value = newId;
			declared = true;
		}
	}

	// Other artifacts' revises:/parts: references.
	for (const [aid, meta] of Object.entries(frontmatter?.artifact ?? {})) {
		if (aid === oldId) continue;
		if (typeof meta?.revises === "string" && matchesOldId(meta.revises)) {
			doc.setIn(["artifact", aid, "revises"], newId);
		}
		if (Array.isArray(meta?.parts)) {
			const partsNode = doc.getIn(["artifact", aid, "parts"], true);
			if (isSeq(partsNode)) {
				for (const item of partsNode.items) {
					if (isScalar(item) && matchesOldId(item.value)) item.value = newId;
				}
			}
		}
	}

	// Every subflow process's boundary: KEY that names oldId (values are the
	// child file's own ids and are never touched).
	for (const [pid, meta] of Object.entries(frontmatter?.process ?? {})) {
		if (!meta?.boundary || typeof meta.boundary !== "object") continue;
		const boundaryNode = doc.getIn(["process", pid, "boundary"], true);
		if (!isMap(boundaryNode)) continue;
		for (const pair of boundaryNode.items) {
			if (isScalar(pair.key) && matchesOldId(pair.key.value)) {
				pair.key.value = newId;
			}
		}
	}

	// Boundary preservation (spec §2.9.3): a subflow process's unmapped
	// boundary artifacts are matched to the child by identical id. When
	// `oldId` is a normal input/output of a subflow process whose `boundary:`
	// did not already map it (the case just rewritten above), renaming it
	// would silently break that identity match unless the map now says so
	// explicitly. Read from the pre-mutation `frontmatter` (the original
	// boundary map, before the key-rename loop above), so this only fires for
	// a boundary that truly lacked `oldId` as a key.
	for (const [pid, meta] of Object.entries(frontmatter?.process ?? {})) {
		if (typeof meta?.subflow !== "string") continue;
		const isBoundaryAdjacent = edges.some(
			(e) =>
				(e.kind === "input" || e.kind === "output") &&
				e.process === pid &&
				e.artifact === oldId,
		);
		if (!isBoundaryAdjacent) continue;
		const originalBoundary =
			meta.boundary && typeof meta.boundary === "object"
				? (meta.boundary as Record<string, unknown>)
				: undefined;
		if (
			originalBoundary !== undefined &&
			Object.hasOwn(originalBoundary, oldId)
		) {
			continue; // already renamed as a key above, value (child id) untouched
		}
		// An existing map gains the entry; anything else — absent, or an
		// empty `boundary:` / `boundary: ~` (null, which `hasIn` still
		// reports as present) — is replaced by a fresh one-entry map.
		if (isMap(doc.getIn(["process", pid, "boundary"], true))) {
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
	let foundInBody = false;
	for (const t of tokens) {
		if (t.type === "ID" && t.value === oldId) {
			bodyOutput += cst.body.slice(cursor, t.start.offset);
			bodyOutput += formatId(newId);
			cursor = t.end.offset;
			foundInBody = true;
		}
	}
	bodyOutput += cst.body.slice(cursor);

	const output = frontmatterOutput + bodyOutput;
	return { output, found: declared || foundInBody, kind, diagnostics };
}
