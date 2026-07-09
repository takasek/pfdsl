/**
 * Pure functions implementing the range rules from ADR-0027 ("レンジ規則",
 * #402): given the 1-indexed line where a `(SPEC_<id>)` definition marker
 * sits, compute the enclosing block's line range — a heading section, a
 * list item (with its nested children), a single table row, or a
 * blank-line-delimited paragraph.
 *
 * Marker detection itself is not reimplemented here; callers locate the
 * marker line via `findSpecIdDefinitions` (spec-id-check.mjs) and pass its
 * `line` into `computeRange`.
 */

const HEADING_RE = /^(#{1,6})\s/;
const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s/;
const TABLE_ROW_RE = /^\s*\|/;
const FENCE_RE = /^(```|~~~)/;

function isBlank(line) {
	return line.trim() === "";
}

function headingLevel(line) {
	const match = HEADING_RE.exec(line);
	return match ? match[1].length : null;
}

function listItemIndent(line) {
	const match = LIST_ITEM_RE.exec(line);
	return match ? match[1].length : null;
}

function leadingWhitespaceLength(line) {
	return /^\s*/.exec(line)[0].length;
}

/**
 * Classifies the block a given line (0-indexed within `lines`) starts,
 * based on that line's own leading syntax — independent of where within
 * the line a marker sits.
 * @param {string[]} lines
 * @param {number} lineIndex
 * @returns {"heading"|"list-item"|"table-row"|"paragraph"}
 */
export function classifyBlock(lines, lineIndex) {
	const line = lines[lineIndex];
	if (headingLevel(line) !== null) return "heading";
	if (listItemIndent(line) !== null) return "list-item";
	if (TABLE_ROW_RE.test(line)) return "table-row";
	return "paragraph";
}

/**
 * Scans forward from `startIndex` (0-indexed, inclusive), skipping lines
 * inside a fenced code block (the fence delimiter lines themselves are
 * still visited — only their *interior* is skipped, per ADR-0027: fence
 * content isn't evaluated as a range boundary, but the fence itself is
 * part of the range). Returns the index of the first non-fenced line for
 * which `shouldStop` returns true, or `lines.length` if none does.
 * @param {string[]} lines
 * @param {number} startIndex
 * @param {(line: string) => boolean} shouldStop
 * @returns {number}
 */
function findBoundary(lines, startIndex, shouldStop) {
	let inFence = false;
	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i];
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (shouldStop(line)) return i;
	}
	return lines.length;
}

function computeHeadingRange(lines, lineIndex) {
	const level = headingLevel(lines[lineIndex]);
	const endIndex = findBoundary(lines, lineIndex + 1, (line) => {
		const lvl = headingLevel(line);
		return lvl !== null && lvl <= level;
	});
	return { startIndex: lineIndex, endIndex: endIndex - 1 };
}

function computeListItemRange(lines, lineIndex) {
	const indent = listItemIndent(lines[lineIndex]);
	const endIndex = findBoundary(lines, lineIndex + 1, (line) => {
		if (isBlank(line)) return false;
		if (listItemIndent(line) === indent) return true; // next sibling item
		return leadingWhitespaceLength(line) < indent; // dedent past the item
	});
	return { startIndex: lineIndex, endIndex: endIndex - 1 };
}

function computeTableRowRange(lineIndex) {
	return { startIndex: lineIndex, endIndex: lineIndex };
}

function computeParagraphRange(lines, lineIndex) {
	let start = lineIndex;
	while (start > 0 && !isBlank(lines[start - 1])) start--;
	let end = lineIndex;
	while (end < lines.length - 1 && !isBlank(lines[end + 1])) end++;
	return { startIndex: start, endIndex: end };
}

/**
 * Splits `text` on "\n" the same way `findSpecIdDefinitions` numbers lines,
 * but drops the single trailing "" that `split` produces when `text` ends
 * with a newline (the common case for files) — without this, an "EOF"
 * range would overshoot by one phantom blank line that isn't actually a
 * line in the file.
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
	const rawLines = text.split("\n");
	if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
		return rawLines.slice(0, -1);
	}
	return rawLines;
}

/**
 * @param {string} text
 * @param {number} lineNumber 1-indexed line where a definition marker sits
 * @returns {{startLine: number, endLine: number}} 1-indexed closed range
 */
export function computeRange(text, lineNumber) {
	const lines = splitLines(text);
	const lineIndex = lineNumber - 1;
	const type = classifyBlock(lines, lineIndex);
	const range =
		type === "heading"
			? computeHeadingRange(lines, lineIndex)
			: type === "list-item"
				? computeListItemRange(lines, lineIndex)
				: type === "table-row"
					? computeTableRowRange(lineIndex)
					: computeParagraphRange(lines, lineIndex);
	return { startLine: range.startIndex + 1, endLine: range.endIndex + 1 };
}
