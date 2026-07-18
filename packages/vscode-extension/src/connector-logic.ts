import type { NormalizedEdge } from "@pfdsl/core";

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

/** Appends edgeLine after the last non-blank line of source (end of the existing edge block). */
export function insertConnectorEdge(
	source: string,
	edgeLine: string,
): ConnectorInsertion {
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
