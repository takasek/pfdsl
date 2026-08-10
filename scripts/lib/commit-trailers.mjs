/**
 * Reading trailers out of commit messages, shared by every check whose input
 * is a declaration the runner writes into a commit rather than into the PR
 * body (#775).
 *
 * A commit message is the one place a declaration can be read at the moment
 * the terminal gate runs — the gate normally runs before the PR exists, so a
 * PR body is both unfetchable and, once fetched, editable after the fact.
 * The review record (#698) already lived here; the size override moved here
 * to join it, and the scan had to stop being private to one of them.
 */

/** Separator the callers' `git log --format` invocation puts between messages. */
export const RECORD_SEP = "\x1e";

/**
 * A line belonging to a trailer block: `Key: value`, git's own convention, or
 * the bare `Refs #603` form this repo writes alongside it. The bare form has
 * to end at the number — prose beginning with a capitalised word wraps onto
 * the next line rather than stopping after an issue reference, and that is
 * what keeps this from matching the first line of a paragraph of prose.
 * Replaying the parser over origin/main found `Refs #N` to be the only
 * colon-less line any trailer block there contains.
 */
const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*(:\s|\s+#\d+\s*$)/;

/**
 * The trailer lines of one commit message: the paragraphs at its end whose
 * every line is `Key: value`, walked backwards until a paragraph containing
 * prose ends the region.
 *
 * Git's own `%(trailers)` stops at the first blank line instead, which this
 * repo's commits do not survive — they put the record in its own paragraph
 * with `Co-Authored-By` after a blank line, so git reads the record as body
 * text. Walking paragraphs keeps those while still ending the region at
 * prose that would otherwise make a commit explaining the mechanism fail its
 * own gate (#726).
 * @param {string} message - one commit message
 * @returns {string[]}
 */
export function trailerRegion(message) {
	const region = [];
	for (const paragraph of message.split(/\n[ \t]*\n/).reverse()) {
		const lines = paragraph.split("\n").filter((line) => line.trim() !== "");
		if (lines.length === 0) continue;
		if (!lines.every((line) => TRAILER_LINE.test(line))) break;
		region.unshift(...lines);
	}
	return region;
}

/**
 * Every trailer line in a blob of commit messages.
 *
 * The per-commit cut is what keeps one message's trailing prose from ending
 * the region of the message that follows it, so callers separate their
 * commits with RECORD_SEP.
 * @param {string} text - commit messages, RECORD_SEP between them
 * @returns {string[]}
 */
export function trailerLines(text) {
	return (text ?? "").split(RECORD_SEP).flatMap(trailerRegion);
}
