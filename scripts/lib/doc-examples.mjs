/**
 * Pure fenced-block extraction for check-doc-examples.mjs (#645): finds
 * ```pfdsl fenced blocks in a Markdown file's text and skips any block whose
 * immediately preceding non-blank line carries a `<!-- pfdsl-nocheck -->`
 * annotation. This used to live inline in the top-level script, doing its own
 * readFileSync, with no test coverage at all — unlike the other 8 orchestrator
 * scripts in #645, this one had no lib/ file and no tests to begin with.
 *
 * No I/O — callers read the file and pass its text in.
 */

const NOCHECK_RE = /<!--\s*pfdsl-nocheck\s*-->/;

/**
 * @param {string} filePath - carried through onto each returned block for reporting
 * @param {string} text
 * @returns {Array<{startLine: number, content: string, filePath: string}>}
 */
export function extractBlocks(filePath, text) {
	const lines = text.split("\n");
	const blocks = [];
	let inBlock = false;
	let startLine = 0;
	let buf = [];
	let skip = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!inBlock) {
			if (line.trimStart().startsWith("```pfdsl")) {
				// Check the immediately preceding non-blank line for nocheck annotation
				let prev = i - 1;
				while (prev >= 0 && lines[prev].trim() === "") prev--;
				skip = prev >= 0 && NOCHECK_RE.test(lines[prev]);
				inBlock = true;
				startLine = i + 1;
				buf = [];
			}
		} else if (line.trimStart().startsWith("```")) {
			if (!skip) {
				blocks.push({ startLine, content: buf.join("\n"), filePath });
			}
			inBlock = false;
			buf = [];
			skip = false;
		} else {
			buf.push(line);
		}
	}

	return blocks;
}
