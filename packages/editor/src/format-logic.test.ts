import { describe, expect, it } from "vitest";
import {
	clampSelectionToBody,
	computeFullDocumentFormatOutput,
	computeRangeFormatOutput,
} from "./format-logic.js";

describe("computeFullDocumentFormatOutput", () => {
	it("returns the formatted output when it differs from the source", () => {
		const source = "req>>design->spec\n";
		const output = computeFullDocumentFormatOutput(source, "flows");
		expect(output).toBe("req >> design -> spec\n");
	});

	it("returns null when the output is unchanged", () => {
		const source = "req >> design -> spec\n";
		expect(computeFullDocumentFormatOutput(source, "flows")).toBeNull();
	});

	it("returns null when formatting produces errors", () => {
		const source = "req >> design\n"; // no output: V003
		expect(computeFullDocumentFormatOutput(source, "flows")).toBeNull();
	});
});

describe("computeRangeFormatOutput", () => {
	it("returns the formatted output for a selection, skipping full-graph validation", () => {
		const selectedText = "req>>design->spec\n";
		const output = computeRangeFormatOutput(selectedText, "flows");
		expect(output).toBe("req >> design -> spec\n");
	});

	it("returns null when the output is unchanged", () => {
		const selectedText = "req >> design -> spec\n";
		expect(computeRangeFormatOutput(selectedText, "flows")).toBeNull();
	});
});

describe("clampSelectionToBody", () => {
	const withFrontmatter =
		"---\nartifact:\n  req:\n    label: Req\n---\nreq >> design -> spec\n";
	// bodyStartLine is 1-based; frontmatter above occupies lines 1-5 (0-based 0-4),
	// so body starts at 0-based line 5.

	it("returns null when the selection is entirely within frontmatter", () => {
		expect(clampSelectionToBody(withFrontmatter, 0, 2)).toBeNull();
	});

	it("clamps the start line down to the body start when selection begins in frontmatter", () => {
		expect(clampSelectionToBody(withFrontmatter, 1, 5)).toEqual({
			startLine: 5,
			endLine: 5,
		});
	});

	it("leaves a selection already inside the body untouched", () => {
		const source = "req >> design -> spec\nspec >> impl -> code\n";
		expect(clampSelectionToBody(source, 1, 1)).toEqual({
			startLine: 1,
			endLine: 1,
		});
	});
});
