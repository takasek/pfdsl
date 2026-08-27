// Puts the retro catalog's `phase: pre-artifact` patterns in front of the
// runner as soon as this cycle's first implementation artifact has been
// written — backing up work-cycle.md 手順2 の P3, which is the reference point
// that actually precedes the writing (#964).
//
// The catalog already had two reference points and neither reaches code. The
// preflight prints these same patterns, but once, before the cycle starts —
// the furthest possible remove from the moment the prose they govern gets
// typed. The terminal gate asks for them again, but only before the PR body,
// by which time the code, its comments, the tests and the commit messages are
// already written. That gap is where a pre-artifact pattern was measured
// leaking into three implementation comments in PR #962.
//
// A backstop, not a replacement for the skill's own "before you write"
// reference point. Being PostToolUse, this fires once the write has landed:
// the artifact that triggers it was never shaped by what it says, and a whole
// file produced in one Write is finished before the first word reaches the
// runner. What it buys is the artifacts after that one, plus the prompt to
// re-read the one just written while it is still the thing being worked on.
// Whether some non-blocking path could instead reach the runner *before* the
// first write was settled in #974, and narrowly. A hook invoked as part of a
// tool call takes that call as its input: the content is fixed before the hook
// runs, and no inference happens between the hook returning and the tool
// executing, so nothing it adds can precede the very call it would have
// reshaped. That closes off the pre-execution hook on the write itself.
//
// It does not close off delivery points earlier than the write; #974 measured
// one arriving ahead of the model's first inference. Those went unused for
// reach rather than ordering: none of the ones compared there got closer to the
// first implementation write than the cycle preflight already is, and the
// preflight prints this same catalog with the countermeasure lines this hook
// has to drop for length (formatPreArtifactAdvisory below). What does create a
// boundary at the write is a decision that stops it, which is a gate rather
// than an advisory — one #974 measured losing the write outright on the runs
// where the model read the denial reason as an injected instruction. Hence
// PostToolUse.
//
// The reach is also bounded by the tool surface it watches. Writes that arrive
// through Bash, a generator, or any tool other than Write/Edit are not seen,
// so "the cycle's first implementation artifact" means the first one written
// through those two tools.
//
// Advisory, never a gate. What a pattern reserves is a shape of prose, and
// whether a given line takes that shape is not decidable from the diff — the
// runner gets the patterns, not a verdict.
//
// Once per writer per cycle — the caller and each delegate separately, and
// again when the next cycle starts (see advisoryKey) — because the scope that
// makes this reach code (every write
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
		"note: this cycle just wrote its first implementation artifact — it is already on disk, so this arrives too late to have shaped it. Re-read what you just wrote against the retro catalog's `phase: pre-artifact` patterns, fix it if one of them reserves the shape it took, and apply them to the artifacts still ahead (the terminal gate asks again, but only once the PR body is being written):",
		...reminders.map((r) => `  - ${r.name} (${r.path})`),
	].join("\n");
}

/**
 * What "already reminded" is scoped to, or null when the payload cannot say.
 *
 * Not `session_id` alone. A subagent shares its parent's `session_id` —
 * delegation-guard's module header is the primary source for that, and for
 * `agent_id` being present only inside a subagent call. Keying on the session
 * would let whichever of the two writes an implementation file first consume
 * the single fire, and since work-cycle.md 適用点3 treats delegating the
 * implementation as an ordinary path, the actor that misses out would
 * routinely be the one actually writing the code. Each delegate gets its own
 * scope instead, and so does the caller.
 *
 * The pair is JSON-encoded rather than joined on a separator. Nothing
 * documents the id formats, and joining on `:` makes session `"a:b"` with no
 * delegate collide with session `"a"` delegate `"b"` — two unrelated scopes
 * sharing one mark, so one of them never sees the advisory at all. The
 * encoding only has to be unambiguous; the wrapper hashes whatever comes back.
 *
 * `cycleId` is in the key because a session outlives a cycle. work-cycle.md
 * 手順1 requires each cycle to cut its own branch, including when the next one
 * starts in the same session — so without it the second cycle inherits the
 * first's mark and its first implementation write says nothing. The branch is
 * what the wrapper passes, standing in for the cycle on the strength of that
 * same rule. A null `cycleId` (the branch could not be read) degrades to a
 * session-wide scope rather than firing on every write.
 *
 * The branch is a proxy, not the cycle itself, and it is the proxy
 * `record-timing-anchor-vs-work-unit` warns about: a second work item stacked
 * onto an existing branch shares its predecessor's scope and gets no advisory.
 * That state already fails the design-record gate for the same reason, and the
 * pattern's own countermeasure is to split the branch — so this key is correct
 * exactly where the convention holds, and silent where it is already broken.
 * @param {object} payload PostToolUse hook payload
 * @param {string | null} cycleId identifier for the cycle in progress
 * @returns {string | null}
 */
export function advisoryKey(payload, cycleId) {
	const session = payload?.session_id;
	if (typeof session !== "string" || session === "") return null;
	const agent = payload?.agent_id;
	const delegate = typeof agent === "string" && agent !== "" ? agent : null;
	const cycle = typeof cycleId === "string" && cycleId !== "" ? cycleId : null;
	return JSON.stringify([session, delegate, cycle]);
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
 * @param {{root: string, cycleId: () => string | null, loadReminders: () => {name: string, path: string}[], hasFired: (key: string) => boolean, markFired: (key: string) => void}} io
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runPreArtifactAdvisory(
	inputText,
	{ root, cycleId, loadReminders, hasFired, markFired },
) {
	const payload = parseHookPayload(inputText);
	if (!payload || !isImplementationArtifactWrite(payload, root))
		return { shouldOutput: false };
	let cycle;
	try {
		cycle = cycleId();
	} catch {
		// Reading the branch shells out; a failure narrows the scope to the
		// session, it does not silence the advisory.
		cycle = null;
	}
	const key = advisoryKey(payload, cycle);
	if (key === null) return { shouldOutput: false };
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
