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

import { gitSubcommand, splitSegments, stripLeadingNoise, tokenize } from "./delegation-guard.mjs";

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
export function evaluateMainCommitGuard(payload, { currentBranch, mainBranch = "main" } = {}) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	if (!isGitCommitCommand(payload?.tool_input?.command)) return { decision: "allow" };
	if (!currentBranch || currentBranch !== mainBranch) return { decision: "allow" };

	return {
		decision: "deny",
		reason:
			`Blocked 'git commit' on '${mainBranch}': this repo's ecosystem requires develop → PR → merge_pr. ` +
			"Create or switch to a feature branch first (e.g. via the worktree skill), then commit there.",
	};
}

/**
 * Build the PreToolUse hook response for a deny decision.
 * @param {{reason: string}} result
 */
export function buildDenyOutput(result) {
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: result.reason,
		},
	};
}
