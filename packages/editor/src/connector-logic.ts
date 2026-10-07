import {
	analyzeSource,
	formatId,
	ID_PATTERN,
	type NodeKind,
	type NormalizedEdge,
} from "@pfdsl/core";
import { idsOfStatement } from "./preview-logic.js";

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
	return connectorSyntax(
		formatId(nodeId),
		nodeRole,
		connector,
		formatId(otherId),
	);
}

/** A syntax example with a placeholder rather than a literal endpoint ID. */
export function connectorChoiceLabel(
	nodeId: string,
	nodeRole: ConnectorRole,
	connector: ConnectorKind,
): string {
	return connectorSyntax(formatId(nodeId), nodeRole, connector, "…");
}

function connectorSyntax(
	node: string,
	nodeRole: ConnectorRole,
	connector: ConnectorKind,
	other: string,
): string {
	if (connector === "->") {
		return nodeRole === "process"
			? `${node} -> ${other}`
			: `${other} -> ${node}`;
	}
	return nodeRole === "artifact"
		? `${node} ${connector} ${other}`
		: `${other} ${connector} ${node}`;
}

export interface ConnectorInsertion {
	text: string;
	insertedLine: number;
	/** True when anchored next to an existing statement (safe to insert as a single line); false for the end-of-document fallback, which also trims trailing blank lines and so needs a full-text replace. */
	anchored: boolean;
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
	const matches = analyzeSource(source).document.statements.flatMap(
		(statement) =>
			idsOfStatement(statement)
				.filter((id) => id.value === nodeId)
				.map((id) => ({
					line: id.start.line - 1,
					endLine: statement.end.line - 1,
				})),
	);
	if (matches.length === 0) return undefined;

	const reference = cursorLine ?? Number.POSITIVE_INFINITY;
	const best = matches.reduce((closest, match) =>
		Math.abs(match.line - reference) <= Math.abs(closest.line - reference)
			? match
			: closest,
	);
	return best.endLine;
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
	const newline = source.includes("\r\n") ? "\r\n" : "\n";
	if (nodeId) {
		const anchor = findRelatedLineIndex(source, nodeId, cursorLine);
		if (anchor !== undefined) {
			const lines = source.split("\n");
			const insertedLine = anchor + 1;
			const insertionOffset =
				lines.slice(0, insertedLine).join("\n").length + 1;
			const text =
				insertionOffset <= source.length
					? `${source.slice(0, insertionOffset)}${edgeLine}${newline}${source.slice(insertionOffset)}`
					: `${source}${newline}${edgeLine}`;
			return { text, insertedLine, anchored: true };
		}
	}
	const trimmed = source.replace(/\s+$/, "");
	const insertedLine = trimmed.length > 0 ? trimmed.split("\n").length : 0;
	const text =
		trimmed.length > 0
			? `${trimmed}${newline}${edgeLine}${newline}`
			: `${edgeLine}${newline}`;
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
 * Existing IDs use their semantic spelling; new IDs retain the bare-ID constraint.
 */
export function validateNewNodeId({
	value,
	currentNodeId,
	wantedKind,
	kindOfExisting,
}: NewNodeIdCheck): string | undefined {
	if (value === currentNodeId) return "Cannot connect a node to itself";
	const existingKind = kindOfExisting(value);
	if (existingKind && existingKind !== wantedKind) {
		return `"${value}" is already ${articleFor(existingKind)} ${existingKind}, not ${articleFor(wantedKind)} ${wantedKind}`;
	}
	if (!existingKind) {
		const fullIdPattern = new RegExp(`^(?:${ID_PATTERN.source})$`, "u");
		if (!fullIdPattern.test(value)) {
			return "Invalid ID — use letters, numbers, _ or - (must start with a letter, number, or _)";
		}
	}
	return undefined;
}
