// Host-independent source positions and preview diagnostics.
import type { Diagnostic, IdNode, Statement } from "@pfdsl/core";

/** A cursor position in the editor's own 0-indexed coordinates. */
export interface CursorPosition {
	line: number;
	character: number;
}

export function idsOfStatement(stmt: Statement): IdNode[] {
	switch (stmt.type) {
		case "chain": {
			const ids: IdNode[] = [...stmt.head.ids];
			for (const seg of stmt.segments) {
				ids.push(seg.process);
				if (seg.output) ids.push(...seg.output.ids);
			}
			return ids;
		}
		case "input-edge":
			return [...stmt.artifact.ids, stmt.process];
		case "feedback-edge":
			return [...stmt.artifact.ids, stmt.process];
		case "output-edge":
			return [stmt.process, ...stmt.artifact.ids];
		case "node-decl":
			return [stmt.id];
	}
}

/**
 * What the preview shows in place of a graph, or undefined when it can render
 * one. An error-severity diagnostic means the document does not describe a
 * graph yet, so rendering the partial one would show something the file does
 * not say (#611).
 */
export function blockingDiagnosticMessage(
	diagnostics: readonly Diagnostic[],
): string | undefined {
	const fatal = diagnostics.find((d) => d.severity === "error");
	return fatal ? `${fatal.code}: ${fatal.message}` : undefined;
}

/**
 * Where an id first appears in the body, as a zero-origin editor position.
 * Statement order is document order, so the first hit is the topmost mention.
 */
export function positionOfNodeId(
	statements: readonly Statement[],
	nodeId: string,
): { line: number; column: number } | undefined {
	for (const stmt of statements) {
		for (const id of idsOfStatement(stmt)) {
			if (id.value === nodeId) {
				return { line: id.start.line - 1, column: id.start.column - 1 };
			}
		}
	}
	return undefined;
}
