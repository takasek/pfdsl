import type { Range as CoreRange } from "@pfdsl/core";

export interface VscodeRangeLike {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export function coreRangeToVscode(r: CoreRange): VscodeRangeLike {
	return {
		startLine: r.start.line - 1,
		startColumn: r.start.column - 1,
		endLine: r.end.line - 1,
		endColumn: r.end.column - 1,
	};
}
