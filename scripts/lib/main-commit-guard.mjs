// Blocks git commands that change the working tree or index while the current
// branch is main (#650, widened in #777). CLAUDE.md and work-cycle.md both say
// "main への直接コミットをしない" — the ecosystem's develop → PR → merge_pr
// path is the only one that runs gate-check and review. Nothing has broken
// this yet, but what has enforced it so far is attention alone.
//
// Commits were the whole of it until a worktree session's shell cwd reverted
// to the main checkout and staged two files there (#777). The commit itself
// was blocked, but the staged files stayed in an index every session shares,
// where the next commit made in the main checkout — by a human, too — picks
// them up. Stopping the commit alone leaves the route into that index open.
//
// currentBranch is passed in rather than read here, since a PreToolUse hook
// payload does not carry it — the hook wrapper resolves it once via `git
// branch --show-current` and this stays a pure function.

import { resolve } from "node:path";
import {
	gitSubcommand,
	splitSegments,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";

// Which subcommands land in which decision follows one rule (#777): deny the
// ones that create new state on the branch, because "do it in a worktree
// instead" is an equivalent substitute and fits in the deny message; ask for
// the ones that destroy or restore existing state, because the payload cannot
// tell an accidental `git reset` from the main-tree recovery CLAUDE.md
// prescribes, and denying those would block the repair as well as the damage.

/** git subcommands denied outright on the default branch. */
const DENIED_SUBCOMMANDS = new Set([
	"commit",
	"add",
	"rm",
	"mv",
	"apply",
	"am",
]);

/** git subcommands routed to the human on the default branch. */
const ASKED_SUBCOMMANDS = new Set([
	"reset",
	"restore",
	"checkout",
	"switch",
	"stash",
	"clean",
	"merge",
	"rebase",
	"cherry-pick",
	"revert",
]);

/**
 * `git stash` forms that only read. CLAUDE.md sends a session that lost an edit
 * to `git stash list` first, so the diagnosis must not need a prompt.
 */
const READ_ONLY_STASH_VERBS = new Set(["list", "show"]);

/**
 * `git apply` flags that report instead of writing. A deny cannot be overridden
 * by the human it prints to, so a subcommand's read-only forms have to stay
 * out of the denied set rather than rely on the prompt.
 */
const READ_ONLY_APPLY_FLAGS = new Set([
	"--check",
	"--stat",
	"--numstat",
	"--summary",
]);

/**
 * The guarded git subcommand one already-tokenized segment runs, or null.
 * @param {{value: string, quoted: boolean}[]} tokens
 * @returns {{subcommand: string, decision: "deny" | "ask"} | null}
 */
function classifySegment(tokens) {
	if (tokens.length === 0) return null;
	const head = tokens[0];
	if (head.quoted || head.value !== "git") return null;

	const sub = gitSubcommand(tokens);
	if (!sub) return null;
	if (DENIED_SUBCOMMANDS.has(sub)) {
		if (
			sub === "apply" &&
			tokens.some((t) => !t.quoted && READ_ONLY_APPLY_FLAGS.has(t.value))
		)
			return null;
		return { subcommand: sub, decision: "deny" };
	}
	if (!ASKED_SUBCOMMANDS.has(sub)) return null;
	// The verb sits to `stash` exactly as a subcommand sits to `git`, so the
	// same reader finds it — including its refusal to read a quoted token,
	// which leaves `git stash "list"` classified as the bare push it may be.
	if (sub === "stash") {
		const at = tokens.findIndex((t) => !t.quoted && t.value === "stash");
		if (READ_ONLY_STASH_VERBS.has(gitSubcommand(tokens.slice(at)) ?? ""))
			return null;
	}
	return { subcommand: sub, decision: "ask" };
}

/**
 * The guarded git subcommand `command` runs, or null if it runs none.
 *
 * A compound line is classified by its strictest match: `git checkout x && git
 * add y` is a deny, since letting the ask through would put the add on the
 * default branch behind a prompt that names the checkout.
 * @param {string} command
 * @returns {{subcommand: string, decision: "deny" | "ask"} | null}
 */
export function classifyGitCommand(command) {
	if (typeof command !== "string" || command.trim() === "") return null;

	/** @type {{subcommand: string, decision: "deny" | "ask"} | null} */
	let asked = null;
	for (const segment of splitSegments(command)) {
		const found = classifySegment(stripLeadingNoise(tokenize(segment)));
		if (found?.decision === "deny") return found;
		if (found) asked ??= found;
	}
	return asked;
}

/** A path this layer can resolve without running a shell. */
function staticPath(token) {
	if (!token) return null;
	if (token.quoted) return token.value;
	return /[$~*?`]/.test(token.value) ? null : token.value;
}

/**
 * The directory the first guarded git command in `command` actually runs in.
 *
 * A PreToolUse hook fires before the shell does, so `payload.cwd` is where the
 * shell stands now — not where a `cd` in the command itself will put it. That
 * gap ran both ways (#751): `cd <worktree> && git commit` was denied as a
 * commit on main while it landed on a feature branch, and the inverse form
 * committed to main from a worktree session without the guard noticing. `git
 * -C <path>` bypassed it outright, since nothing looked at the flag.
 *
 * The first guarded segment is what fixes the tree, even when a later segment
 * carries the stricter decision — a compound that cds between the two is rare
 * enough not to justify a second notion of "the" directory here.
 *
 * Anything the layer cannot resolve statically — a variable, a `~`, a bare
 * `cd` — falls back to the hook's cwd rather than being guessed at, which
 * leaves the guard exactly as accurate as it was before for those forms. An
 * absolute `cd` afterwards restores the trail, since it does not depend on
 * where the unresolvable one led.
 * @param {string} command
 * @param {string} hookCwd payload.cwd
 * @returns {string}
 */
export function resolveCommandCwd(command, hookCwd) {
	if (typeof command !== "string") return hookCwd;

	/** Where the shell stands, or null once a `cd` moved it somewhere unknown. */
	let cwd = hookCwd;

	for (const segment of splitSegments(command)) {
		const tokens = stripLeadingNoise(tokenize(segment));
		if (tokens.length === 0 || tokens[0].quoted) continue;
		const head = tokens[0].value;

		if (head === "cd") {
			const target = tokens.length === 2 ? staticPath(tokens[1]) : null;
			if (target === null) cwd = null;
			// An absolute target ignores whatever came before it, so a trail lost
			// to an unresolvable `cd` is known again from here on.
			else if (target.startsWith("/")) cwd = resolve(target);
			else if (cwd !== null) cwd = resolve(cwd, target);
			continue;
		}

		if (head !== "git" || !classifySegment(tokens)) continue;

		// `git -C` decides the tree regardless of any cd before it.
		const flag = tokens.findIndex(
			(t, i) => i > 0 && !t.quoted && t.value === "-C",
		);
		const explicit = flag > 0 ? staticPath(tokens[flag + 1]) : null;
		return explicit === null
			? (cwd ?? hookCwd)
			: resolve(cwd ?? hookCwd, explicit);
	}
	return cwd ?? hookCwd;
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{currentBranch: string | undefined, mainBranch?: string}} context
 * @returns {{decision: "allow"} | {decision: "deny" | "ask", reason: string}}
 */
export function evaluateMainCommitGuard(
	payload,
	{ currentBranch, mainBranch = "main" } = {},
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const guarded = classifyGitCommand(payload?.tool_input?.command);
	if (!guarded) return { decision: "allow" };
	if (!currentBranch || currentBranch !== mainBranch)
		return { decision: "allow" };

	const command = `git ${guarded.subcommand}`;
	if (guarded.decision === "deny") {
		return {
			decision: "deny",
			reason:
				`Blocked '${command}' on '${mainBranch}': this repo's ecosystem requires develop → PR → merge_pr, ` +
				"and the main checkout's index is shared by every session, so anything staged here rides along on " +
				"the next commit made there. Create or switch to a feature branch first (e.g. via the worktree " +
				"skill), then run it there.",
		};
	}
	return {
		decision: "ask",
		reason:
			`'${command}' on '${mainBranch}' would change the main checkout's working tree, which every session ` +
			"shares — it can discard another session's uncommitted edits. It is also how CLAUDE.md says to repair " +
			"a tree that was written to by mistake, and this hook cannot tell the two apart. Confirm only if this " +
			"is the repair.",
	};
}

/**
 * Orchestrates the hook's stdin payload into a print-or-not decision, the way
 * runDelegationGuard does (#645).
 *
 * `resolveBranches` is injected and called only once the command is known to be
 * a guarded one. That is what keeps the `git` subprocess off every other Bash
 * call without duplicating the eligibility rule in the wrapper — the earlier
 * version repeated the tool_name/classify check there and carried a comment
 * asking the next reader to keep the two copies in sync by hand.
 * @param {string} inputText raw stdin payload
 * @param {{resolveBranches: (payload: object) => {currentBranch?: string, mainBranch?: string}}} io
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runMainCommitGuard(inputText, { resolveBranches }) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };
	if (payload?.tool_name !== "Bash") return { shouldOutput: false };
	if (!classifyGitCommand(payload?.tool_input?.command))
		return { shouldOutput: false };

	const result = evaluateMainCommitGuard(payload, resolveBranches(payload));
	if (result.decision === "allow") return { shouldOutput: false };
	return { shouldOutput: true, output: buildPermissionOutput(result) };
}
