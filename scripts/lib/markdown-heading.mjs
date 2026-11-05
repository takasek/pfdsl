/**
 * Shared predicate for "is this line an ATX markdown heading" (`#` through
 * `######`, followed by whitespace, anchored at the line start — no leading
 * whitespace tolerance). Multiple checkers under scripts/lib answer this
 * same question independently; this module is the single place it's
 * answered, so a change to the semantics changes it everywhere at once.
 *
 * This does not cover setext headings, blockquote/list line-head decoration
 * (see gate-check.mjs's LINE_HEAD_DECORATION, which strips several kinds of
 * decoration for an unrelated purpose), or table-row classification.
 */

const HEADING_RE = /^(#{1,6})\s/;

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isHeading(line) {
	return HEADING_RE.test(line);
}

/**
 * @param {string} line
 * @returns {number | null} the hash count (1-6), or null if not a heading
 */
export function headingLevel(line) {
	const match = HEADING_RE.exec(line);
	return match ? match[1].length : null;
}

/**
 * @param {string} line
 * @returns {string | null} the heading body with the marker and its
 * following whitespace stripped and surrounding whitespace trimmed, or null
 * if not a heading
 */
export function headingText(line) {
	if (!isHeading(line)) return null;
	return line.replace(/^#{1,6}\s+/, "").trim();
}
