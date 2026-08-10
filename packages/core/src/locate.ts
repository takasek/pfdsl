import { isMap, isScalar, type Pair } from "yaml";
import { parseFrontmatterCst } from "./frontmatter-cst.js";
import type {
	ArtifactExpr,
	Document,
	IdNode,
	NodeKind,
	Statement,
} from "./types/index.js";

export interface LocateResult {
	/** 1-based line of the id's frontmatter section key, or null if it has none. */
	declarationLine: number | null;
	/** 1-based lines (ascending, deduped) where the id appears in the body AST. */
	edgeLines: number[];
}

/** The node id a `Pair`'s key represents, or null when the key isn't a plain scalar. */
function pairId(pair: Pair): string | null {
	return isScalar(pair.key) ? String(pair.key.value) : null;
}

/**
 * The offset of `id`'s key scalar within the frontmatter's yaml text (as
 * parsed by `parseFrontmatterCst`), looked up in the one section its `kind`
 * names — the same kind-scoped dispatch `setFrontmatterField` uses on the
 * write path. Null when `id` has no frontmatter entry.
 */
function declarationOffset(
	doc: ReturnType<typeof parseFrontmatterCst>["doc"],
	id: string,
	kind: NodeKind,
): number | null {
	const section = doc.get(kind, true);
	if (!isMap(section)) return null;
	for (const item of section.items) {
		if (pairId(item) === id && isScalar(item.key) && item.key.range) {
			return item.key.range[0];
		}
	}
	return null;
}

/**
 * yaml text (as read by `parseFrontmatterCst`) always begins on the source's
 * second line: the fence's opening `---` occupies line 1 in full, and yaml
 * text is sliced starting right after that line's own newline — a
 * structural fact of the fence format, not a re-derivation of its parsing.
 */
const FRONTMATTER_YAML_START_LINE = 2;

/** 1-based line number of `offset` within `text`, counting `\n` (CRLF-safe: every line break has exactly one). */
function lineAtOffset(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text[i] === "\n") line++;
	}
	return line;
}

function collectIds(node: IdNode, id: string, lines: Set<number>): void {
	if (node.value === id) lines.add(node.start.line);
}

function collectExprIds(
	expr: ArtifactExpr,
	id: string,
	lines: Set<number>,
): void {
	for (const idNode of expr.ids) collectIds(idNode, id, lines);
}

/** Every id occurrence in one body statement, regardless of statement kind. */
function collectStatementIds(
	stmt: Statement,
	id: string,
	lines: Set<number>,
): void {
	switch (stmt.type) {
		case "chain":
			collectExprIds(stmt.head, id, lines);
			for (const seg of stmt.segments) {
				collectIds(seg.process, id, lines);
				if (seg.output) collectExprIds(seg.output, id, lines);
			}
			return;
		case "input-edge":
		case "feedback-edge":
			collectExprIds(stmt.artifact, id, lines);
			collectIds(stmt.process, id, lines);
			return;
		case "output-edge":
			collectIds(stmt.process, id, lines);
			collectExprIds(stmt.artifact, id, lines);
			return;
		case "node-decl":
			collectIds(stmt.id, id, lines);
			return;
	}
}

/**
 * Where `id` appears in `source`: its frontmatter declaration key line (if
 * any) and every distinct body line it's mentioned on (declaration and edge
 * are the only two occurrence kinds — a `node-decl` for an otherwise-isolated
 * node counts as the latter, same as any other body statement). Built purely
 * from `analyze()`'s AST (`document`, whose `IdNode` positions are already
 * shifted onto full-file line numbers) and `parseFrontmatterCst`'s yaml CST
 * (`range` offsets) — no re-scanning of `source`'s lines (#829).
 *
 * Takes the `document` and `kind` the caller already resolved, the way
 * `computeNeighbors` takes an already-built `graph`: every caller reaches
 * here through its own `analyze()`, so re-deriving them would parse,
 * normalize and validate the same source a second time. `source` is still
 * needed because `AnalyzeResult` carries no frontmatter CST, and the key
 * offsets only exist there.
 */
export function locateNode(
	document: Document,
	source: string,
	id: string,
	kind: NodeKind,
): LocateResult {
	const edgeLineSet = new Set<number>();
	for (const stmt of document.statements) {
		collectStatementIds(stmt, id, edgeLineSet);
	}

	const cst = parseFrontmatterCst(source);
	let declarationLine: number | null = null;
	if (cst.present) {
		const offset = declarationOffset(cst.doc, id, kind);
		if (offset !== null) {
			declarationLine =
				FRONTMATTER_YAML_START_LINE - 1 + lineAtOffset(cst.yamlText, offset);
		}
	}

	return {
		declarationLine,
		edgeLines: [...edgeLineSet].sort((a, b) => a - b),
	};
}
