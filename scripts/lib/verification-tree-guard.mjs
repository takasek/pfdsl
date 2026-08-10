// Asks before a test/build/check command runs while this shell's cwd has
// drifted from its linked worktree back to the main checkout (#840).
//
// A worktree session's Bash cwd can revert to the main checkout between
// calls (see CLAUDE.md "worktree でのファイル操作パス"). When that happens,
// `make test` runs against the main checkout's tree — which does not contain
// the worktree branch's changes — and a pass there reads exactly like a pass
// of the branch under review, because nothing in the command's own output
// says which tree it ran against. worktree-write-guard.mjs closes the
// equivalent gap for Edit/Write; this closes it for verification commands.
//
// Ask, not deny: a deliberate check of the main checkout itself (e.g. before
// a release) is a legitimate reason to run these commands there, and denying
// would remove the only way to do that. A PreToolUse hook also has no
// advisory channel that reaches the model — `additionalContext` is
// PostToolUse-only (see hook-io.mjs) — so `ask` is the only way this can
// surface as a warning at all, the same reasoning main-commit-guard.mjs
// applies to its ASKED_SUBCOMMANDS.
//
// The tree this reads is the payload's cwd, which is where the command
// starts, not where it ends up: a `cd <dir> && make test` is judged on the
// directory the shell was in before the `cd`. That misses both ways — a
// drifted shell that cds back into the worktree is asked about anyway, and
// one that cds out of it is not asked at all. Splitting the directory change
// into its own call is what makes either case visible, which is why
// work-cycle.md tells a cycle to do that rather than chain the two.

import {
	splitSegments,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";

/** `make` target prefixes treated as verification. */
const VERIFICATION_MAKE_TARGET_PREFIXES = ["test", "check", "build"];

/** `-C`/`--directory` forms that make an explicit cwd part of the command, so
 * cwd drift cannot affect it. `--directory=<path>` arrives as one token, so
 * the flag name is read up to `=` and compared by equality rather than via
 * `startsWith("--directory=")` — the latter is a string literal handed to
 * `startsWith`, the shape check-cli-conventions.mjs flags (#648) even though
 * this parses another command's arguments, not this script's own argv (the
 * same distinction command-usage-guard.mjs is exempted by name for there).
 */
function hasExplicitCwdFlag(tokens) {
	return tokens.some((t) => {
		if (t.quoted) return false;
		const flagName = t.value.split("=", 1)[0];
		return flagName === "-C" || flagName === "--directory";
	});
}

/** Whether `rest` (the tokens after `make`) targets test/check/build. */
function isVerificationMake(rest) {
	if (hasExplicitCwdFlag(rest)) return false;
	return rest.some(
		(t) =>
			!t.quoted &&
			VERIFICATION_MAKE_TARGET_PREFIXES.some((prefix) =>
				t.value.startsWith(prefix),
			),
	);
}

/** Whether `rest` (the tokens after `node`) is a `--test` invocation. */
function isNodeTest(rest) {
	return rest.some((t) => !t.quoted && t.value === "--test");
}

/** Whether `rest` (the tokens after `pnpm`) runs a test or build script. */
function isVerificationPnpm(rest) {
	if (rest.some((t) => !t.quoted && t.value === "-C")) return false;
	return rest.some(
		(t) => !t.quoted && (t.value === "test" || t.value === "build"),
	);
}

/** Whether one already-split segment is a verification command. */
function isVerificationSegment(segment) {
	const tokens = stripLeadingNoise(tokenize(segment));
	if (tokens.length === 0) return false;
	const head = tokens[0];
	if (head.quoted) return false;
	const rest = tokens.slice(1);

	if (head.value === "make") return isVerificationMake(rest);
	if (head.value === "node") return isNodeTest(rest);
	if (head.value === "pnpm") return isVerificationPnpm(rest);
	return false;
}

/**
 * The verification-ish segments (test/check/build via make, node --test, or
 * pnpm) found in `command`, trimmed. A command with none returns `[]`.
 * `make -C <path>` / `--directory[=]<path>` and `pnpm -C <path>` are excluded:
 * naming a cwd explicitly means drift cannot change which tree they run
 * against.
 * @param {string} command
 * @returns {string[]}
 */
export function findVerificationSegments(command) {
	if (typeof command !== "string" || command.trim() === "") return [];
	return splitSegments(command)
		.filter((segment) => isVerificationSegment(segment))
		.map((segment) => segment.trim());
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{worktreeRoot: string, mainRoot: string, hasLinkedWorktrees: boolean} | null} roots
 *   git-derived roots for the session's cwd, or null when they could not be
 *   resolved (cwd missing, not a git repo, `git` failure)
 * @returns {{decision: "allow"} | {decision: "ask", reason: string}}
 */
export function evaluateVerificationTreeGuard(payload, roots) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };

	const command = payload?.tool_input?.command;
	if (typeof command !== "string") return { decision: "allow" };
	if (findVerificationSegments(command).length === 0)
		return { decision: "allow" };

	if (!roots) return { decision: "allow" };
	// cwd's toplevel and its git-common-dir's parent coincide exactly when cwd
	// is the main checkout itself. Anything else is a linked worktree, which is
	// normal operation, not drift.
	if (roots.worktreeRoot !== roots.mainRoot) return { decision: "allow" };
	// No linked worktree exists anywhere in this repo, so there is no branch's
	// changes for this tree to be missing.
	if (roots.hasLinkedWorktrees === false) return { decision: "allow" };

	return {
		decision: "ask",
		reason:
			`This shell's cwd is the main checkout ('${roots.mainRoot}'), not the linked worktree ` +
			"a session normally runs verification from. That tree does not contain the linked worktree's " +
			"branch changes, so a green result here can be misread as confirmation that those changes pass " +
			"— it looks identical to a genuine run. If this is an intentional check of the main checkout " +
			"itself (e.g. a release check), confirm to proceed.",
	};
}
