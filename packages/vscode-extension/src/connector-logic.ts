import { loadFrontmatter, type NormalizedEdge } from "@pfdsl/core";

export type ConnectorDirection = "before" | "after";
export type ConnectorKind = ">>" | ">>?" | "->";

/** >>/>>? attach before the current node (as its input); -> attaches after (as its output). */
export function directionForKind(connector: ConnectorKind): ConnectorDirection {
	return connector === "->" ? "after" : "before";
}

export function buildConnectorEdgeLine(
	nodeId: string,
	direction: ConnectorDirection,
	connector: ConnectorKind,
	otherId: string,
): string {
	return direction === "before"
		? `${otherId} ${connector} ${nodeId}`
		: `${nodeId} ${connector} ${otherId}`;
}

export interface ConnectorInsertion {
	text: string;
	insertedLine: number;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CONTINUATION_PREFIXES = [">>?", ">>", "->"];

/**
 * Last body line index (0-indexed) mentioning nodeId as a whole ID, extended
 * through any continuation lines that follow it (operator-first next line),
 * so the new edge lands next to the statement it's related to instead of
 * always at the end of the document. Returns undefined if nodeId doesn't
 * appear in any body line (nothing to anchor to).
 */
function findRelatedLineIndex(
	source: string,
	nodeId: string,
): number | undefined {
	const { bodyStartLine } = loadFrontmatter(source);
	const lines = source.split("\n");
	const bodyStart = Math.max(bodyStartLine - 1, 0);
	const pattern = new RegExp(
		`(?<![\\p{L}\\p{N}_-])${escapeRegex(nodeId)}(?![\\p{L}\\p{N}_-])`,
		"u",
	);

	let lastMatch: number | undefined;
	for (let i = bodyStart; i < lines.length; i++) {
		const line = lines[i];
		if (line !== undefined && pattern.test(line)) lastMatch = i;
	}
	if (lastMatch === undefined) return undefined;

	let idx = lastMatch;
	while (idx + 1 < lines.length) {
		const next = lines[idx + 1]?.trimStart() ?? "";
		if (!CONTINUATION_PREFIXES.some((op) => next.startsWith(op))) break;
		idx++;
	}
	return idx;
}

/**
 * Inserts edgeLine right after the last body line related to nodeId (its
 * statement, including continuation lines), or — if nodeId doesn't appear in
 * any body edge yet — after the last non-blank line of the document.
 */
export function insertConnectorEdge(
	source: string,
	edgeLine: string,
	nodeId?: string,
): ConnectorInsertion {
	if (nodeId) {
		const anchor = findRelatedLineIndex(source, nodeId);
		if (anchor !== undefined) {
			const lines = source.split("\n");
			const insertedLine = anchor + 1;
			lines.splice(insertedLine, 0, edgeLine);
			return { text: lines.join("\n"), insertedLine };
		}
	}
	const trimmed = source.replace(/\s+$/, "");
	const insertedLine = trimmed.length > 0 ? trimmed.split("\n").length : 0;
	const text =
		trimmed.length > 0 ? `${trimmed}\n${edgeLine}\n` : `${edgeLine}\n`;
	return { text, insertedLine };
}

/** Whether the edge a connector choice would create is already present among the document's normalized edges. */
export function edgeAlreadyExists(
	edges: readonly NormalizedEdge[],
	nodeId: string,
	connector: ConnectorKind,
	otherId: string,
): boolean {
	if (connector === "->") {
		return edges.some(
			(e) =>
				e.kind === "output" && e.process === nodeId && e.artifact === otherId,
		);
	}
	const kind = connector === ">>" ? "input" : "feedback";
	return edges.some(
		(e) => e.kind === kind && e.process === nodeId && e.artifact === otherId,
	);
}
