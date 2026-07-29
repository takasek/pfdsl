/**
 * Pure mid-sentence-line-break detection for check-md-linebreaks.mjs (#645).
 *
 * This used to live entirely in the top-level script: `checkFile`,
 * `endsAtBoundary`, `BOUNDARY`, `CLOSE`, `LIST_RE` were defined at module top
 * level but never exported, AND the same module ran its argv parsing, its
 * `git ls-files` call, its main loop and `process.exit` unconditionally at
 * import time — so merely importing the file to test `checkFile` would have
 * run the whole CLI. Moving the detection logic here, with no top-level
 * side effect and `checkFile` taking text instead of doing its own
 * readFileSync, is what makes it importable for a test at all.
 *
 * No I/O — callers read the file and pass its text in.
 */

/** Characters a line may end on without the following continuation counting as a mid-sentence break. */
export const BOUNDARY = new Set([..."。！？」』）…～.!?:*"]);
/** Closing-bracket characters that also count as a valid line end. */
export const CLOSE = new Set([..."`])}"]);
/** Matches a list-marker-led line (bullet or ordered), with its leading indent captured. */
export const LIST_RE = /^(\s*)([-*+]|\d+[.)]) /;

/**
 * @param {string} line
 * @returns {boolean} whether the line, once trailing whitespace is dropped, ends at a sentence boundary
 */
export function endsAtBoundary(line) {
	const r = line.trimEnd();
	if (!r) return true;
	const c = r[r.length - 1];
	return BOUNDARY.has(c) || CLOSE.has(c);
}

/**
 * Finds mid-sentence line breaks in a single file's already-read text.
 * Skips fenced code blocks, YAML frontmatter, list-marker continuation
 * lines, and continuations preceded by a blank line.
 * @param {string} filePath - carried through onto each returned violation for reporting
 * @param {string} text
 * @returns {Array<{file: string, line: number, prev: string, cont: string}>}
 */
export function checkFile(filePath, text) {
	const lines = text.split("\n");
	const violations = [];
	let inFence = false;
	// Track YAML frontmatter (--- ... ---)
	let inFrontmatter = lines[0]?.trim() === "---";

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		const stripped = line.trimStart();

		// Close frontmatter on second ---
		if (inFrontmatter) {
			if (stripped === "---") inFrontmatter = false;
			continue;
		}

		// Fence delimiters toggle state and are skipped themselves
		if (stripped.startsWith("```") || stripped.startsWith("~~~")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		// Only check indented continuation lines that are not list markers
		if (!line || line[0] !== " " || !stripped || LIST_RE.test(stripped)) continue;

		const prev = lines[i - 1];

		// Blank line before → indented code block or loose list paragraph; skip
		if (!prev || !prev.trim()) continue;

		if (!endsAtBoundary(prev)) {
			violations.push({
				file: filePath,
				line: i + 1,
				prev: prev.trimEnd(),
				cont: stripped,
			});
		}
	}

	return violations;
}
