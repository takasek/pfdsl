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
 * Lines that carry markdown structure rather than prose (#770). A heading, a
 * table row, a blockquote marker, a raw HTML tag, a thematic break and a setext
 * underline all end on characters that are not sentence boundaries, so once the
 * check covers unindented lines these would each report a violation on the line
 * next to them. Measured on this repo's 218 tracked .md files: without these
 * skips the broadened check reports 685 violations, with them 149. Of those 149,
 * 119 were genuine mid-sentence prose breaks and 30 were unfenced code snippets
 * in a single ADR — code that is not prose is out of this regex's reach, and the
 * fix for it is a code fence in the document, not another skip here.
 *
 * The `<` alternative reads as "raw HTML", but it also exempts angle-bracket
 * grammar notation (`<statement> ::= …`). Narrowing it is not worth it: dropping
 * `<` altogether flags 19 real `<details>`/`<summary>` lines in generated docs,
 * and no pattern separates those from EBNF by their first character. Fence such
 * blocks so they are skipped for the right reason.
 */
export const STRUCTURAL_RE = /^(#{1,6} |\||>|<|-{3,}$|={3,}$|\*{3,}$|_{3,}$)/;

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
	// Stripped once up front rather than per use: every line is needed both as
	// the continuation under test and, one iteration later, as the previous
	// line whose structure decides whether the break counts.
	const strippedLines = lines.map((l) => l.trimStart());
	const violations = [];
	let inFence = false;
	// Track YAML frontmatter (--- ... ---)
	let inFrontmatter = lines[0]?.trim() === "---";

	for (let i = 1; i < lines.length; i++) {
		const stripped = strippedLines[i];

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

		// Continuation lines that are not list markers. Indented and unindented
		// alike: prose is unindented, and it is prose the docstring and
		// CLAUDE.md claim is covered (#770).
		if (!stripped || LIST_RE.test(stripped)) continue;

		const prev = lines[i - 1];

		// Blank line before → indented code block or loose list paragraph; skip
		if (!prev?.trim()) continue;

		// Either side being markdown structure rather than prose
		if (
			STRUCTURAL_RE.test(stripped) ||
			STRUCTURAL_RE.test(strippedLines[i - 1])
		)
			continue;

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
