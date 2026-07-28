import {
	ID_PATTERN,
	loadFrontmatter,
	type NodeKind,
	type NormalizedEdge,
} from "@pfdsl/core";

/** The DSL role the current node plays in the edge being built. */
export type ConnectorRole = "artifact" | "process";
export type ConnectorKind = ">>" | ">>?" | "->";

/**
 * Builds the edge line text. `>>`/`>>?` always read artifact-then-process
 * left-to-right; `->` always reads process-then-artifact. nodeRole says
 * which slot the current node occupies, so a connector invoked on an
 * artifact and one invoked on a process produce differently-shaped lines
 * for the same connector kind.
 */
export function buildConnectorEdgeLine(
	nodeId: string,
	nodeRole: ConnectorRole,
	connector: ConnectorKind,
	otherId: string,
): string {
	if (connector === "->") {
		return nodeRole === "process"
			? `${nodeId} -> ${otherId}`
			: `${otherId} -> ${nodeId}`;
	}
	return nodeRole === "artifact"
		? `${nodeId} ${connector} ${otherId}`
		: `${otherId} ${connector} ${nodeId}`;
}

export interface ConnectorInsertion {
	text: string;
	insertedLine: number;
	/** True when anchored next to an existing statement (safe to insert as a single line); false for the end-of-document fallback, which also trims trailing blank lines and so needs a full-text replace. */
	anchored: boolean;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CONTINUATION_PREFIXES = [">>?", ">>", "->"];

/**
 * Whole-ID match for nodeId, boundary-aware against the DSL's `-` arrow
 * character: a trailing `-` only breaks the match if it is NOT the start of
 * `->` (an ID's own hyphen still breaks it, e.g. nodeId "build" must not
 * match inside "build-foo", but must match in "build->x" with no space
 * before the arrow).
 */
function wholeIdPattern(nodeId: string): RegExp {
	return new RegExp(
		`(?<![\\p{L}\\p{N}_-])${escapeRegex(nodeId)}(?![\\p{L}\\p{N}_]|-(?!>))`,
		"u",
	);
}

/**
 * Body line index (0-indexed) of the nodeId occurrence nearest cursorLine
 * (nearest by line distance; ties favor the later occurrence), extended
 * through any continuation lines that follow it (operator-first next line),
 * so the new edge lands next to the statement the user is actually looking
 * at. Without cursorLine, falls back to the last occurrence in the
 * document. Returns undefined if nodeId doesn't appear in any body line.
 */
function findRelatedLineIndex(
	source: string,
	nodeId: string,
	cursorLine?: number,
): number | undefined {
	const { bodyStartLine } = loadFrontmatter(source);
	const lines = source.split("\n");
	const bodyStart = Math.max(bodyStartLine - 1, 0);
	const pattern = wholeIdPattern(nodeId);

	const matches: number[] = [];
	for (let i = bodyStart; i < lines.length; i++) {
		const line = lines[i];
		if (line !== undefined && pattern.test(line)) matches.push(i);
	}
	if (matches.length === 0) return undefined;

	const reference = cursorLine ?? Number.POSITIVE_INFINITY;
	const best = matches.reduce((closest, i) =>
		Math.abs(i - reference) <= Math.abs(closest - reference) ? i : closest,
	);

	let idx = best;
	while (idx + 1 < lines.length) {
		const next = lines[idx + 1]?.trimStart() ?? "";
		if (!CONTINUATION_PREFIXES.some((op) => next.startsWith(op))) break;
		idx++;
	}
	return idx;
}

/**
 * Inserts edgeLine right after the body statement (including continuation
 * lines) for the nodeId occurrence nearest cursorLine, or — if nodeId
 * doesn't appear in any body edge yet — after the last non-blank line of
 * the document.
 */
export function insertConnectorEdge(
	source: string,
	edgeLine: string,
	nodeId?: string,
	cursorLine?: number,
): ConnectorInsertion {
	if (nodeId) {
		const anchor = findRelatedLineIndex(source, nodeId, cursorLine);
		if (anchor !== undefined) {
			const lines = source.split("\n");
			const insertedLine = anchor + 1;
			lines.splice(insertedLine, 0, edgeLine);
			return { text: lines.join("\n"), insertedLine, anchored: true };
		}
	}
	const trimmed = source.replace(/\s+$/, "");
	const insertedLine = trimmed.length > 0 ? trimmed.split("\n").length : 0;
	const text =
		trimmed.length > 0 ? `${trimmed}\n${edgeLine}\n` : `${edgeLine}\n`;
	return { text, insertedLine, anchored: false };
}

/** Whether the edge a connector choice would create is already present among the document's normalized edges. */
export function edgeAlreadyExists(
	edges: readonly NormalizedEdge[],
	nodeId: string,
	nodeRole: ConnectorRole,
	connector: ConnectorKind,
	otherId: string,
): boolean {
	if (connector === "->") {
		const process = nodeRole === "process" ? nodeId : otherId;
		const artifact = nodeRole === "process" ? otherId : nodeId;
		return edges.some(
			(e) =>
				e.kind === "output" && e.process === process && e.artifact === artifact,
		);
	}
	const kind = connector === ">>" ? "input" : "feedback";
	const artifact = nodeRole === "artifact" ? nodeId : otherId;
	const process = nodeRole === "artifact" ? otherId : nodeId;
	return edges.some(
		(e) => e.kind === kind && e.artifact === artifact && e.process === process,
	);
}

/** The kind an "other node" must have to be a valid endpoint for a given connector choice. */
export function compatibleOtherKind(nodeRole: ConnectorRole): NodeKind {
	return nodeRole === "artifact" ? "process" : "artifact";
}

function articleFor(word: string): string {
	return /^[aeiou]/i.test(word) ? "an" : "a";
}

export interface NewNodeIdCheck {
	/** What the user has typed so far. */
	value: string;
	/** The node the connector was invoked on, which cannot be the other end. */
	currentNodeId: string;
	/** The kind the other end must have for this connector. */
	wantedKind: NodeKind;
	/** The kind an id already has in the document, or undefined if it is new. */
	kindOfExisting: (id: string) => NodeKind | undefined;
}

/**
 * The message to show under the connector's id input box, or undefined when
 * the id is usable. Written as a predicate rather than inline in the
 * showInputBox options so the three refusals are testable (#611).
 */
export function validateNewNodeId({
	value,
	currentNodeId,
	wantedKind,
	kindOfExisting,
}: NewNodeIdCheck): string | undefined {
	const fullIdPattern = new RegExp(`^(?:${ID_PATTERN.source})$`, "u");
	if (!fullIdPattern.test(value)) {
		return "Invalid ID — use letters, numbers, _ or - (must start with a letter, number, or _)";
	}
	if (value === currentNodeId) return "Cannot connect a node to itself";
	const existingKind = kindOfExisting(value);
	if (existingKind && existingKind !== wantedKind) {
		return `"${value}" is already ${articleFor(existingKind)} ${existingKind}, not ${articleFor(wantedKind)} ${wantedKind}`;
	}
	return undefined;
}
