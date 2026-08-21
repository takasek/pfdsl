// Asks, at the moment prose lands in a `.pfdsl/*.md` companion, the two
// questions that decide whether it belongs there at all: could a mechanism
// carry it instead, and — if the rule text does not depend on this repo's
// proper nouns — does it belong in the distributed layer, where an adopting
// repo can actually receive it (#922).
//
// Advisory, not a verdict. The distinction the L4 stagnation audit draws is
// "does the rule text *depend* on a proper noun", and that is not decidable
// from the text: a proxy predicate (does the line contain an issue number, a
// path, an ADR id) was measured against this repo's own companion and admitted
// 49 of 183 lines while catching only 3 of the 5 rules the audit had found by
// hand — one candidate cited a slash command as an example, another had
// already been reduced to a pointer. Presence and dependence fall on the same
// values, so a gate built on them would be printing PASS/FAIL over a
// distinction its materials cannot make. The runner gets the questions instead.
//
// The timing is the whole point. The terminal gate already prints the
// knowledge-artifact size deltas every cycle, but it prints them after the
// prose is written, and by then the choice of where to write it has been made.
//
// Scope is the top-level companions only. The retro-pattern catalog beside
// them is a different genre — a trap record with its evidence, not a rule
// looking for a home — and the graphs move for reasons this is not about.

import { buildAdvisoryOutput, parseHookPayload } from "./hook-io.mjs";

const COMPANION_PATH = /(^|\/)\.pfdsl\/[^/]+\.md$/;

/**
 * The non-blank lines this tool call introduced.
 *
 * A Write replaces the file, so its whole content counts. An Edit is compared
 * against the text it replaced: a line already present in `old_string` is being
 * moved or reindented, not added, and a pure deletion adds nothing at all —
 * neither should raise a question about where new prose belongs.
 * @param {object} payload PostToolUse hook payload
 * @returns {string[]}
 */
export function addedProseLines(payload) {
	const input = payload?.tool_input ?? {};
	const text =
		payload?.tool_name === "Write" ? input.content : input.new_string;
	if (typeof text !== "string") return [];
	const before = new Set(
		typeof input.old_string === "string"
			? input.old_string.split("\n").map((l) => l.trim())
			: [],
	);
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "" && !before.has(l));
}

/**
 * Whether this payload added prose to a top-level `.pfdsl/*.md` companion.
 * @param {object} payload PostToolUse hook payload
 * @returns {boolean}
 */
export function isCompanionProseAddition(payload) {
	if (payload?.tool_name !== "Write" && payload?.tool_name !== "Edit")
		return false;
	const filePath = payload?.tool_input?.file_path;
	if (typeof filePath !== "string" || !COMPANION_PATH.test(filePath))
		return false;
	return addedProseLines(payload).length > 0;
}

/**
 * The advisory text for a companion that just gained prose.
 * @param {string} filePath
 * @returns {string}
 */
export function formatCompanionProseAdvisory(filePath) {
	return [
		`note: ${filePath} gained prose. Two questions before it settles there:`,
		"  (a) is this decidable from a command, a path, or the repository's state? then a hook or a check carries it, and prose is the fallback.",
		"  (b) does the rule text depend on this repo's proper nouns? if not, it belongs in the distributed layer (a skill's references/) — a companion is not distributed, so a general rule left here never reaches an adopting repo.",
	].join("\n");
}

/**
 * Orchestrates the hook's stdin payload into a print-or-not decision.
 * @param {string} inputText raw stdin payload
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runCompanionProseAdvisory(inputText) {
	const payload = parseHookPayload(inputText);
	if (!payload || !isCompanionProseAddition(payload))
		return { shouldOutput: false };
	return {
		shouldOutput: true,
		output: buildAdvisoryOutput(
			formatCompanionProseAdvisory(payload.tool_input.file_path),
		),
	};
}
