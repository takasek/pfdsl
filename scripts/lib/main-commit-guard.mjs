// Blocks `git commit` while the current branch is main (#650). CLAUDE.md and
// work-cycle.md both say "main への直接コミットをしない" — the ecosystem's
// develop → PR → merge_pr path is the only one that runs gate-check and
// review. Nothing has broken this yet, but what has enforced it so far is
// attention alone.
//
// Deny: the roadmap this replaces says there is essentially no legitimate
// case for committing straight to main in this repo, so false positives are
// not a real risk here.
//
// currentBranch is passed in rather than read here, since a PreToolUse hook
// payload does not carry it — the hook wrapper resolves it once via `git
// branch --show-current` and this stays a pure function.

import {
	gitSubcommand,
	splitSegments,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";

/**
 * Whether `command` runs `git commit` in any segment of a compound line.
 * @param {string} command
 * @returns {boolean}
 */
export function isGitCommitCommand(command) {
	if (typeof command !== "string" || command.trim() === "") return false;

	for (const segment of splitSegments(command)) {
		const tokens = stripLeadingNoise(tokenize(segment));
		if (tokens.length === 0) continue;
		const head = tokens[0];
		if (head.quoted || head.value !== "git") continue;
		if (gitSubcommand(tokens) === "commit") return true;
	}
	return false;
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{currentBranch: string | undefined, mainBranch?: string}} context
 * @returns {{decision: "allow"} | {decision: "deny", reason: string}}
 */
export function evaluateMainCommitGuard(
	payload,
	{ currentBranch, mainBranch = "main" } = {},
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	if (!isGitCommitCommand(payload?.tool_input?.command))
		return { decision: "allow" };
	if (!currentBranch || currentBranch !== mainBranch)
		return { decision: "allow" };

	return {
		decision: "deny",
		reason:
			`Blocked 'git commit' on '${mainBranch}': this repo's ecosystem requires develop → PR → merge_pr. ` +
			"Create or switch to a feature branch first (e.g. via the worktree skill), then commit there.",
	};
}

/**
 * Orchestrates the hook's stdin payload into a print-or-not decision, the way
 * runDelegationGuard does (#645).
 *
 * `resolveBranches` is injected and called only once the command is known to be
 * a commit. That is what keeps the `git` subprocess off every other Bash call
 * without duplicating the eligibility rule in the wrapper — the earlier version
 * repeated the tool_name/isGitCommitCommand check there and carried a comment
 * asking the next reader to keep the two copies in sync by hand.
 * @param {string} inputText raw stdin payload
 * @param {{resolveBranches: (payload: object) => {currentBranch?: string, mainBranch?: string}}} io
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runMainCommitGuard(inputText, { resolveBranches }) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };
	if (payload?.tool_name !== "Bash") return { shouldOutput: false };
	if (!isGitCommitCommand(payload?.tool_input?.command))
		return { shouldOutput: false };

	const result = evaluateMainCommitGuard(payload, resolveBranches(payload));
	if (result.decision !== "deny") return { shouldOutput: false };
	return { shouldOutput: true, output: buildPermissionOutput(result) };
}
