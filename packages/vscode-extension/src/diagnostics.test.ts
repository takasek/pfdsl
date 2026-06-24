import { describe, expect, it } from "vitest";
import { coreRangeToVscode } from "./diagnostics-logic.js";

describe("coreRangeToVscode", () => {
	it("converts 1-based core range to 0-based vscode range", () => {
		const result = coreRangeToVscode({
			start: { line: 1, column: 1, offset: 0 },
			end: { line: 1, column: 5, offset: 4 },
		});
		expect(result).toEqual({
			startLine: 0,
			startColumn: 0,
			endLine: 0,
			endColumn: 4,
		});
	});

	it("converts multiline range correctly", () => {
		const result = coreRangeToVscode({
			start: { line: 3, column: 2, offset: 20 },
			end: { line: 5, column: 8, offset: 50 },
		});
		expect(result.startLine).toBe(2);
		expect(result.startColumn).toBe(1);
		expect(result.endLine).toBe(4);
		expect(result.endColumn).toBe(7);
	});
});
