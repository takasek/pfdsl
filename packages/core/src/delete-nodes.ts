import { Document, isMap, isScalar, isSeq } from "yaml";
import { formatId } from "./formatter.js";
import {
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";
import { analyze } from "./index.js";
import { lex } from "./lexer.js";
import { parseTokens } from "./parser.js";
import type {
	ArtifactExpr,
	Diagnostic,
	Statement,
	Token,
} from "./types/index.js";

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
 * A trimmed role, in the notation the formatter would choose for it: bare for
 * a single id, bracketed for several (formatter.ts's `fmtIds`). Bracketing
 * unconditionally would leave `[b]` where canonical is `b`, and `make
 * check-fmt` runs `fmt --check` over the operational `.pfdsl/`, so a sweep
 * that trimmed a role would hand its own PR a red check.
 *
 * Each id goes through formatId (the same function formatter.ts uses) rather
 * than being written raw: an id that needs quoting (spaces, punctuation
 * outside BARE_ID_RE) must keep its quotes on every re-emission, or the
 * parser reads its two words as two separate ids and silently forks the edge
 * in two (#1125 defect 2).
 */
function renderExpr(ids: string[]): string {
	const formatted = ids.map(formatId);
	return formatted.length === 1 ? formatted[0]! : `[${formatted.join(", ")}]`;
}

/**
 * Render a role's surviving ids: verbatim from `body` (preserving the
 * original bracket-vs-bare notation and spacing) when nothing was removed
 * from it, or the canonical bracket form when it was actually trimmed. Only
 * ever called with a non-empty `keptIds` — an emptied-out role means the
 * statement (or link) it belonged to was dropped before reaching here.
 */
function renderRole(
	original: ArtifactExpr,
	keptIds: string[],
	body: string,
): string {
	if (keptIds.length === original.ids.length) {
		return body.slice(original.start.offset, original.end.offset);
	}
	return renderExpr(keptIds);
}

/** Text between `stmt`'s own end and a trailing same-line `# comment`, folded into the statement's span. */
function statementEndOffset(
	stmt: Statement,
	body: string,
	comments: Token[],
): number {
	const next = comments.find((c) => c.start.offset >= stmt.end.offset);
	if (!next || next.start.line !== stmt.end.line) return stmt.end.offset;
	const between = body.slice(stmt.end.offset, next.start.offset);
	if (!/^[ \t\r]*$/.test(between)) return stmt.end.offset;
	return next.end.offset;
}

interface StatementAction {
	kind: "keep" | "drop" | "replace";
	text?: string;
}

/**
 * Decide what becomes of one statement given the set of ids being deleted.
 * `found` accumulates every deleted id actually seen in the body (for the
 * caller's deleted/notFound split), independent of whether the surrounding
 * statement itself survives.
 */
function planStatement(
	stmt: Statement,
	deleteSet: ReadonlySet<string>,
	found: Set<string>,
	body: string,
): StatementAction {
	const markFound = (id: string): void => {
		if (deleteSet.has(id)) found.add(id);
	};

	switch (stmt.type) {
		case "node-decl": {
			markFound(stmt.id.value);
			return deleteSet.has(stmt.id.value) ? { kind: "drop" } : { kind: "keep" };
		}

		case "input-edge":
		case "feedback-edge": {
			for (const i of stmt.artifact.ids) markFound(i.value);
			markFound(stmt.process.value);
			if (deleteSet.has(stmt.process.value)) return { kind: "drop" };
			const kept = stmt.artifact.ids
				.map((i) => i.value)
				.filter((v) => !deleteSet.has(v));
			if (kept.length === 0) return { kind: "drop" };
			if (kept.length === stmt.artifact.ids.length) return { kind: "keep" };
			const op = stmt.type === "input-edge" ? ">>" : ">>?";
			return {
				kind: "replace",
				text: `${renderExpr(kept)} ${op} ${formatId(stmt.process.value)}`,
			};
		}

		case "output-edge": {
			for (const i of stmt.artifact.ids) markFound(i.value);
			markFound(stmt.process.value);
			if (deleteSet.has(stmt.process.value)) return { kind: "drop" };
			const kept = stmt.artifact.ids
				.map((i) => i.value)
				.filter((v) => !deleteSet.has(v));
			if (kept.length === 0) return { kind: "drop" };
			if (kept.length === stmt.artifact.ids.length) return { kind: "keep" };
			return {
				kind: "replace",
				text: `${formatId(stmt.process.value)} -> ${renderExpr(kept)}`,
			};
		}

		case "chain": {
			for (const i of stmt.head.ids) markFound(i.value);
			for (const seg of stmt.segments) {
				markFound(seg.process.value);
				for (const i of seg.output?.ids ?? []) markFound(i.value);
			}
			const touched =
				stmt.head.ids.some((i) => deleteSet.has(i.value)) ||
				stmt.segments.some(
					(seg) =>
						deleteSet.has(seg.process.value) ||
						(seg.output?.ids.some((i) => deleteSet.has(i.value)) ?? false),
				);
			if (!touched) return { kind: "keep" };

			// A chain is a sequence of links (artifact-role -> process ->
			// artifact-role, per §9's semantics — the same translation
			// normalizer.ts applies to build the graph). Deleting an id can
			// sever a link at either end (the process itself, or the role on
			// either side going empty); this walks the segments once, fusing
			// every still-connected run of links back into one chain statement
			// (so an untouched middle segment keeps its `->` continuation
			// rather than being split for no reason) and starting a fresh line
			// only where a break actually occurred.
			const lines: string[] = [];
			let run = "";
			let pendingIds = stmt.head.ids
				.map((i) => i.value)
				.filter((id) => !deleteSet.has(id));
			let pendingRole: ArtifactExpr = stmt.head;

			for (const seg of stmt.segments) {
				const proc = formatId(seg.process.value);
				const procAlive = !deleteSet.has(seg.process.value);
				const inputAttaches = pendingIds.length > 0 && procAlive;

				if (!inputAttaches) {
					if (run !== "") {
						lines.push(run);
						run = "";
					}
				} else if (run === "") {
					run = `${renderRole(pendingRole, pendingIds, body)} ${seg.op} ${proc}`;
				} else {
					run += ` ${seg.op} ${proc}`;
				}

				if (seg.output === null) {
					if (inputAttaches) {
						lines.push(run);
						run = "";
					}
					pendingIds = [];
					continue;
				}

				const outputIds = seg.output.ids
					.map((i) => i.value)
					.filter((id) => !deleteSet.has(id));
				const outputAttaches = outputIds.length > 0 && procAlive;
				if (outputAttaches) {
					const rendered = renderRole(seg.output, outputIds, body);
					if (inputAttaches) {
						run += ` -> ${rendered}`; // stays open for a possible next link
					} else {
						lines.push(`${proc} -> ${rendered}`);
					}
				} else if (inputAttaches) {
					// Input side survived but this link's own output vanished —
					// what's left is a complete input-edge, not a continuing chain.
					lines.push(run);
					run = "";
				}
				pendingIds = outputIds;
				pendingRole = seg.output;
			}
			if (run !== "") lines.push(run);

			return lines.length === 0
				? { kind: "drop" }
				: { kind: "replace", text: lines.join("\n") };
		}
	}
}

/**
 * Rebuild `body` with each statement kept, replaced, or dropped per `plan`.
 *
 * Model the body as gap, statement, gap, statement, ..., gap (n statements,
 * n+1 gaps: the leading gap before the first statement, one between each
 * consecutive pair, and the trailing gap — comments included — after the
 * last). Dropping a maximal run of consecutive statements also drops exactly
 * one of the gaps touching that run, chosen so the two statements now made
 * adjacent (or the file's own leading/trailing whitespace, if the run sits at
 * either end) are separated by exactly the one gap that already sat between
 * them — never zero, never two. A run at the very start keeps the file's
 * leading gap and drops its own trailing one; a run at the very end keeps the
 * trailing gap and drops its own leading one; an interior run keeps its
 * leading gap and drops the rest.
 */
function spliceBody(
	body: string,
	statements: Statement[],
	plan: StatementAction[],
	comments: Token[],
): string {
	const n = statements.length;
	if (n === 0) return body;

	const starts = statements.map((s) => s.start.offset);
	const ends = statements.map((s) => statementEndOffset(s, body, comments));
	const gaps: string[] = [body.slice(0, starts[0])];
	for (let k = 1; k < n; k++) gaps.push(body.slice(ends[k - 1]!, starts[k]));
	gaps.push(body.slice(ends[n - 1]!));

	const removeGap = new Array<boolean>(n + 1).fill(false);
	let i = 0;
	while (i < n) {
		if (plan[i]!.kind !== "drop") {
			i++;
			continue;
		}
		let j = i;
		while (j < n && plan[j]!.kind === "drop") j++;
		if (i === 0) {
			for (let k = 1; k <= j; k++) removeGap[k] = true;
		} else if (j === n) {
			for (let k = i; k <= n - 1; k++) removeGap[k] = true;
		} else {
			for (let k = i + 1; k <= j; k++) removeGap[k] = true;
		}
		i = j;
	}

	let out = "";
	for (let k = 0; k <= n; k++) {
		if (!removeGap[k]) out += gaps[k];
		if (k < n) {
			const action = plan[k]!;
			if (action.kind === "keep") out += body.slice(starts[k]!, ends[k]!);
			else if (action.kind === "replace") {
				// `ends[k]` reaches past a trailing same-line comment so that a
				// dropped statement takes its comment with it. A replaced one must
				// carry that tail across instead: the statement is regenerated, but
				// the author's note on it is not ours to discard.
				out += action.text + body.slice(statements[k]!.end.offset, ends[k]!);
			}
		}
	}
	return out;
}

/**
 * Remove one or more nodes from a `.pfdsl` document in a single pass: the
 * frontmatter declaration block, every body edge occurrence, and every
 * surviving node's `revises:` / `parts:` / `boundary:` reference to the
 * deleted id. Applied atomically across all three so a caller can never end
 * up with a declaration and no edge occurrence (or vice versa) — the
 * decomposed repair this API exists to close off.
 *
 * The frontmatter half is applied through the yaml CST (ADR-0034), the same
 * way `insertDefinition` and `reindex` do, so unrelated comments, quote
 * style, and flow-vs-block choice survive untouched. When a node's whole
 * declaration section goes empty (its last entry removed), the section key
 * itself is left in place with an empty mapping — the yaml package's own
 * `deleteIn` already leaves `artifact: {}` rather than dropping the key, and
 * there is no benefit to a special case that fights that default just to
 * shrink the file by one line.
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

	// Strip dangling references from surviving nodes. Read from the
	// pre-mutation plain-object frontmatter (already parsed by analyze()
	// above); the CST edits below are applied to `doc`, the same mutable
	// document the declaration removal above worked on.
	for (const [aid, meta] of Object.entries(frontmatter?.artifact ?? {})) {
		if (deleteSet.has(aid)) continue;
		if (typeof meta?.revises === "string" && deleteSet.has(meta.revises)) {
			doc.deleteIn(["artifact", aid, "revises"]);
		}
		if (Array.isArray(meta?.parts)) {
			const partsNode = doc.getIn(["artifact", aid, "parts"], true);
			if (isSeq(partsNode)) {
				const before = partsNode.items.length;
				partsNode.items = partsNode.items.filter(
					(item) => !(isScalar(item) && deleteSet.has(String(item.value))),
				);
				if (partsNode.items.length !== before) {
					if (partsNode.items.length === 0) {
						doc.deleteIn(["artifact", aid, "parts"]);
					}
				}
			}
		}
	}
	for (const [pid, meta] of Object.entries(frontmatter?.process ?? {})) {
		if (deleteSet.has(pid)) continue;
		if (meta?.boundary && typeof meta.boundary === "object") {
			const boundaryNode = doc.getIn(["process", pid, "boundary"], true);
			if (isMap(boundaryNode)) {
				const before = boundaryNode.items.length;
				boundaryNode.items = boundaryNode.items.filter(
					(pair) =>
						!(isScalar(pair.key) && deleteSet.has(String(pair.key.value))),
				);
				if (
					boundaryNode.items.length !== before &&
					boundaryNode.items.length === 0
				) {
					doc.deleteIn(["process", pid, "boundary"]);
				}
			}
		}
	}

	const frontmatterOutput = cst.present
		? renderFrontmatterCst(doc, cst.newline, cst.yamlText)
		: "";

	const { tokens } = lex(cst.body);
	const { document } = parseTokens(tokens);
	const comments = tokens.filter((t) => t.type === "COMMENT");
	const plan = document.statements.map((stmt) =>
		planStatement(stmt, deleteSet, found, cst.body),
	);
	const bodyOutput = spliceBody(cst.body, document.statements, plan, comments);

	const output = frontmatterOutput + bodyOutput;

	const deleted = [...ids].filter((id) => found.has(id));
	const notFound = [...ids].filter((id) => !found.has(id));
	return { output, deleted, notFound, diagnostics };
}
