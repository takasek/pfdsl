/**
 * Pure functions for detecting stale forward-reference phrases in prose.
 * See docs/review-prompts.md C系 "stale 前方参照": phrases like
 * "将来版に委ねる" / "別途定義する" go stale when the referenced future
 * feature ships and the text isn't updated (e.g. §15.8/§15.9 kept saying
 * "マルチファイル仕様（将来版）に委ねる" after §2.9 shipped multifile
 * semantics — F4 in docs/adr/0020-spec-stress-testing/spec-v0011-review.md).
 *
 * This check cannot know whether a given reference is actually stale — that
 * requires human judgment about whether the referenced feature now exists.
 * It only flags every occurrence as a prompt for that judgment call.
 */

// Matched as regexes (not plain substrings) because in practice the phrase
// is broken up by a parenthetical, e.g. "マルチファイル仕様（将来版）に委ねる"
// — "将来版" and "に委ねる" are adjacent but a closing "）" sits between them.
const PATTERNS = [
	{ label: "将来版に委ねる", re: /将来版[）)]?に委ねる/g },
	{ label: "別途定義する", re: /別途定義する/g },
];

/**
 * @param {string} text
 * @returns {Array<{line: number, phrase: string, context: string}>}
 */
export function findStaleForwardRefs(text) {
	const hits = [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const { label, re } of PATTERNS) {
			re.lastIndex = 0;
			if (re.test(line)) {
				hits.push({ line: i + 1, phrase: label, context: line.trim() });
			}
		}
	}
	return hits;
}

/**
 * @param {Array<{file: string, line: number, phrase: string, context: string}>} hits
 * @returns {string}
 */
export function formatStaleForwardRefs(hits) {
	return hits
		.map(
			(h) =>
				`${h.file}:${h.line}: stale forward-reference phrase "${h.phrase}"\n  ${h.context}`,
		)
		.join("\n");
}
