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

import { trailerLines } from "./commit-trailers.mjs";
import { matchesTrigger } from "./gate-check.mjs";

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
export const REVIEW_TOOLS = [
	"code-review",
	"code-reviewer-agent",
	"simplify",
	"correctness",
	"design",
	"experience",
];

/**
 * Tools that can satisfy the "delegated review ran" gate.
 * `code-review` runs after a PR exists, so it structurally cannot satisfy a
 * trailer required before the commit — it stays a valid trailer value (a
 * cycle that ran it still records it, so the record does not read as
 * malformed) but does not count toward the gate.
 */
export const GATE_TOOLS = REVIEW_TOOLS.filter((tool) => tool !== "code-review");

/**
 * Tools whose brief includes falsifying the diff's factual claims.
 * `design` subsumes `correctness`'s brief, so a cycle that ran `design` owes
 * no separate `correctness` pass.
 */
export const CORRECTNESS_TOOLS = ["correctness", "design"];

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
 * Every record in one blob of commit messages.
 *
 * A cycle writes one trailer per review pass, so the blob has to be cut per
 * commit and then per trailer line before parsing — `parseReviewTrailer`
 * reads only the first match in whatever it is handed.
 * @param {string} text - commit messages, RECORD_SEP between them
 * @returns {Array<object>} one parsed record per trailer, in order
 */
export function parseReviewRecords(text) {
	return trailerLines(text)
		.filter((line) => line.startsWith("Review:"))
		.map(parseReviewTrailer)
		.filter(Boolean);
}

/**
 * Judge one cycle against its own diff.
 * Two independent questions, both scoped to a cycle that changed code: does
 * it carry a record from a tool that can satisfy the gate at all, and does
 * it carry one whose brief includes falsifying the diff's factual claims
 * (#838). Malformed records (no `tool`) carry no value to check against
 * either set, so they are excluded here — the caller reports them on its own.
 * @param {{changedFiles: string[], records: Array<{tool?: string, error?: string}>}} cycle
 * @returns {string[]} one line per problem, empty when the cycle is in order
 */
export function classifyCycle({ changedFiles, records }) {
	if (!matchesTrigger(changedFiles, CODE_PATH)) return [];

	const tools = records.filter((r) => r.tool !== undefined).map((r) => r.tool);
	const problems = [];
	if (!tools.some((tool) => GATE_TOOLS.includes(tool)))
		problems.push(
			// A cycle that recorded only a non-gate tool did write a record, so
			// "carries no review record" would send its author grepping for a
			// trailer that is right there. Name which half of the rule is unmet.
			tools.length === 0
				? "changed code but carries no review record"
				: "changed code but carries a review record that counts toward no gate (code-review runs after the PR exists)",
		);
	if (!tools.some((tool) => CORRECTNESS_TOOLS.includes(tool)))
		problems.push(
			"changed code but carries no correctness review record (tool=correctness or design)",
		);
	return problems;
}
