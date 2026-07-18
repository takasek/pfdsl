export type ConnectorDirection = "before" | "after";
export type ConnectorKind = ">>" | ">>?" | "->";

/** Connector kinds valid for a given direction (§lexer ARROW_INPUT/ARROW_FEEDBACK/ARROW_OUTPUT). */
export function connectorKindsFor(
	direction: ConnectorDirection,
): ConnectorKind[] {
	return direction === "before" ? [">>", ">>?"] : ["->"];
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
