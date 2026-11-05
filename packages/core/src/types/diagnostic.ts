import type { Position } from "./token.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Range {
	start: Position;
	end: Position;
}

export interface Diagnostic {
	severity: DiagnosticSeverity;
	code: string;
	message: string;
	range: Range;
	/** IDs of the artifacts, processes, or groups targeted by this diagnostic.
	 * Omitted when unknown; present lists are nonempty and contain no duplicates. */
	nodeIds?: string[];
}
