/**
 * Pure functions for the "a cycle that changed code cannot skip review"
 * check (#561, #789).
 *
 * Records live in commit trailers rather than in a companion file or an
 * issue thread: a per-cycle append log in a file conflicts across parallel
 * worktrees (the reason ADR-0026 removed the retro execution record), and a
 * PR body does not exist yet when the terminal gate runs.
 *
 * Trailer form (one per review pass, in any commit of the range):
 *   Review: tool=simplify
 *
 * Process/git I/O lives in the caller scripts; this module stays testable.
 */

import { matchesTrigger } from "./gate-check.mjs";

/** Separator used by the callers' `git log --format` invocation. */
export const RECORD_SEP = "\x1e";

const TRAILER = /^Review:\s*(.*)$/m;
const PAIR = /(\w+)=(?:"([^"]*)"|(\S+))/g;

/**
 * Paths whose change means a cycle changed code and so owes a review record.
 * Kept beside the parser so the predicate has one anchor in code; the prose
 * statement of the same rule lives in the terminal-gate section of the
 * roadmap companion.
 */
export const CODE_PATH = /^(packages|scripts)\//;

/** The review tools the rule accepts. */
export const REVIEW_TOOLS = ["code-review", "code-reviewer-agent", "simplify"];

/**
 * Parse a trailer out of a commit message (subject and body).
 * A malformed record carries `error` instead of throwing.
 * @param {string} text - a commit message, or any text that may contain the trailer line
 * @returns {{tool?: string, error?: string}|null}
 */
export function parseReviewTrailer(text) {
	const match = TRAILER.exec(text);
	if (!match) return null;

	/** @type {Record<string, string>} */
	const fields = {};
	for (const [, key, quoted, bare] of match[1].matchAll(PAIR)) {
		fields[key] = quoted ?? bare;
	}

	if (fields.tool === undefined) {
		return { error: "tool is required" };
	}
	if (!REVIEW_TOOLS.includes(fields.tool)) {
		return {
			error: `tool must be one of ${REVIEW_TOOLS.join(", ")}, got ${JSON.stringify(fields.tool)}`,
		};
	}
	return { tool: fields.tool };
}

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
function trailerRegion(message) {
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
 * Every record in one blob of commit messages.
 *
 * A cycle writes one trailer per review pass, so the blob has to be cut per
 * commit and then per trailer line before parsing — `parseReviewTrailer`
 * reads only the first match in whatever it is handed. Both callers — the
 * terminal gate and the CI check — need the same cut, and the way it is made
 * is the sort of thing that drifts silently when it lives in two places. The
 * per-commit cut is what keeps one message's trailing prose from ending the
 * region of the message that follows it, so both callers separate their
 * commits with RECORD_SEP.
 * @param {string} text - commit messages, RECORD_SEP between them
 * @returns {Array<object>} one parsed record per trailer, in order
 */
export function parseReviewRecords(text) {
	return text
		.split(RECORD_SEP)
		.flatMap(trailerRegion)
		.filter((line) => line.startsWith("Review:"))
		.map(parseReviewTrailer)
		.filter(Boolean);
}

/**
 * Judge one cycle against its own diff.
 * The only question this asks is whether a cycle that changed code carries
 * at least one record — a cycle that recorded several passes is not a
 * problem, it reviewed several times.
 * @param {{changedFiles: string[], recordCount: number}} cycle
 * @returns {string[]} one line per problem, empty when the cycle is in order
 */
export function classifyCycle({ changedFiles, recordCount }) {
	if (matchesTrigger(changedFiles, CODE_PATH) && recordCount === 0)
		return ["changed code but carries no review record"];
	return [];
}
