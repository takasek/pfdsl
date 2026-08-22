// Puts the retro catalog's `phase: pre-artifact` patterns in front of the
// runner at the moment this cycle's first implementation artifact is written
// (#964, work-cycle.md 手順2 の P3).
//
// The catalog already had two reference points and neither reaches code. The
// preflight prints these same patterns, but once, before the cycle starts —
// the furthest possible remove from the moment the prose they govern gets
// typed. The terminal gate asks for them again, but only before the PR body,
// by which time the code, its comments, the tests and the commit messages are
// already written. That gap is where a pre-artifact pattern was measured
// leaking into three implementation comments in PR #962. Prose alone cannot
// close it: a third reference point in the skill is still a reference point,
// and "printed" and "read" stay different things. Firing on the write is the
// only form that does not depend on the runner having remembered.
//
// Advisory, never a gate. What a pattern reserves is a shape of prose, and
// whether a given line takes that shape is not decidable from the diff — the
// runner gets the patterns, not a verdict.
//
// Once per session, because the scope that makes this reach code (every write
// under packages/ and scripts/) is also what would make an unconditional
// advisory fire dozens of times a cycle. companion-prose-advisory, the closest
// existing hook, needs no such state only because `.pfdsl/*.md` is narrow
// enough that repetition never became the cost.

import { isAbsolute, relative } from "node:path";
import { buildAdvisoryOutput, parseHookPayload } from "./hook-io.mjs";

/** Where this repo's implementation artifacts live, as a path relative to the
 * repo root. Matching the raw absolute path instead would reach any directory
 * of these names anywhere on disk — another checkout's `scripts/`, a
 * dependency's vendored `packages/` — and because this advisory fires only
 * once per session, one such write consumes the single fire and the real one
 * later in the same session gets nothing. */
const IMPLEMENTATION_PATH = /^(packages|scripts)\//;

/** Prose extensions, excluded even under an implementation root. */
const PROSE_FILE = /\.(md|txt)$/;

/**
 * Whether this payload wrote an implementation artifact of the repo at `root`.
 *
 * A path that is not absolute cannot be placed against the root at all, so it
 * is not counted — the payload's `file_path` is absolute in practice, and
 * guessing a base for one that is not would reintroduce the reach this
 * anchoring exists to remove.
 * @param {object} payload PostToolUse hook payload
 * @param {string} root absolute path to the repo root
 * @returns {boolean}
 */
export function isImplementationArtifactWrite(payload, root) {
	if (payload?.tool_name !== "Write" && payload?.tool_name !== "Edit")
		return false;
	const filePath = payload?.tool_input?.file_path;
	if (typeof filePath !== "string" || !isAbsolute(filePath)) return false;
	if (PROSE_FILE.test(filePath)) return false;
	return IMPLEMENTATION_PATH.test(relative(root, filePath));
}

/**
 * The advisory text for a set of pre-artifact reminders.
 *
 * Names and paths only, deliberately not the countermeasure lines the
 * preflight prints. Measured on the real catalog (28 patterns): names and
 * paths 3902 bytes, the same list with countermeasures 12402. What this
 * reference point has to enable is recognition —
 * "does one of these reserve the shape I am about to type" — and the
 * countermeasure has already been printed once this cycle by the preflight,
 * which is the reference point that can afford the length. The path is how to
 * read further for the one that matches.
 * @param {{name: string, path: string}[]} reminders
 * @returns {string}
 */
export function formatPreArtifactAdvisory(reminders) {
	return [
		"note: this cycle just wrote its first implementation artifact. The retro catalog's `phase: pre-artifact` patterns only bite before the prose exists — the terminal gate asks for them again, but by then this file is written. Open the ones that could reserve the shape of what you are writing:",
		...reminders.map((r) => `  - ${r.name} (${r.path})`),
	].join("\n");
}

/**
 * Orchestrates the hook's stdin payload into a print-or-not decision.
 *
 * Every quiet path is deliberate. A missing `session_id` means there is no key
 * to dedupe on, and an advisory that cannot be limited to once would be worse
 * than none at this scope. An unreadable catalog is reported by the preflight,
 * which loads the same directory and has somewhere to put the error; a write
 * hook does not. Neither of those marks the session, so the reminder still
 * lands on a later write once the cause is gone.
 *
 * `markFired` failing is the one case that does not silence the advisory. The
 * mark is an optimisation against repetition, and a hook that threw on an
 * unwritable temp directory would fail the only contract that actually matters
 * here — never disturbing the tool call it observes. The cost of losing the
 * mark is that the advisory repeats; the cost of throwing is a broken write.
 * @param {string} inputText raw stdin payload
 * @param {{root: string, loadReminders: () => {name: string, path: string}[], hasFired: (key: string) => boolean, markFired: (key: string) => void}} io
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runPreArtifactAdvisory(
	inputText,
	{ root, loadReminders, hasFired, markFired },
) {
	const payload = parseHookPayload(inputText);
	if (!payload || !isImplementationArtifactWrite(payload, root))
		return { shouldOutput: false };
	const key = payload.session_id;
	if (typeof key !== "string" || key === "") return { shouldOutput: false };
	let fired;
	try {
		fired = hasFired(key);
	} catch {
		fired = false;
	}
	if (fired) return { shouldOutput: false };
	let reminders;
	try {
		reminders = loadReminders();
	} catch {
		return { shouldOutput: false };
	}
	if (reminders.length === 0) return { shouldOutput: false };
	try {
		markFired(key);
	} catch {
		// Losing the mark costs repetition; throwing costs the write.
	}
	return {
		shouldOutput: true,
		output: buildAdvisoryOutput(formatPreArtifactAdvisory(reminders)),
	};
}
