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
}
