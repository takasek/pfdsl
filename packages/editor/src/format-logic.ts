import { format, hasErrors, loadFrontmatter } from "@pfdsl/core";

export type FormatStyle = "flows" | "flat";

/**
 * Formats the whole document. Returns null when formatting produced errors
 * or the output is identical to the input (nothing to edit).
 */
export function computeFullDocumentFormatOutput(
	source: string,
	style: FormatStyle,
): string | null {
	const { output, diagnostics } = format(source, { style });
	if (hasErrors(diagnostics)) return null;
	if (output === source) return null;
	return output;
}

/**
 * Formats an already line-expanded selection (see `clampSelectionToBody`).
 * Returns null when formatting produced errors or the output is identical to
 * the input (nothing to edit).
 */
export function computeRangeFormatOutput(
	selectedText: string,
	style: FormatStyle,
): string | null {
	const { output, diagnostics } = format(selectedText, {
		style,
		skipValidation: true,
	});
	if (hasErrors(diagnostics)) return null;
	if (output === selectedText) return null;
	return output;
}

/**
 * Clamps a 0-based [startLine, endLine] selection so it never starts inside
 * the frontmatter block. Returns null when the selection is entirely within
 * the frontmatter (nothing to format).
 */
export function clampSelectionToBody(
	source: string,
	startLine: number,
	endLine: number,
): { startLine: number; endLine: number } | null {
	const frontmatterLineCount = loadFrontmatter(source).bodyStartLine - 1;
	if (endLine < frontmatterLineCount) return null;
	return { startLine: Math.max(startLine, frontmatterLineCount), endLine };
}
