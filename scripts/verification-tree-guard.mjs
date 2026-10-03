#!/usr/bin/env node

// PreToolUse(Bash): resolve each verification process's effective cwd.
// Unknown targets deny; Claude's known implicit main checkout asks when linked
// worktrees exist. Explicit cwd supports deliberate verification of any tree.
// An absolute Node script path does not identify process.cwd().
//
// Usage (wired in .claude/settings.json): node scripts/verification-tree-guard.mjs

import { readStdinText } from "./lib/hook-io.mjs";
import {
	hasGitTargetEnvironment,
	resolveGitRoots,
	tryGit,
	withoutGitTargetEnvironment,
} from "./lib/run-exec.mjs";
import {
	runVerificationTreeGuard,
	supportsPermissionAsk,
} from "./lib/verification-tree-guard.mjs";

/**
 * @param {string} cwd
 * @returns {{worktreeRoot: string, mainRoot: string, hasLinkedWorktrees: boolean} | null}
 */
function resolveRoots(cwd) {
	const roots = resolveGitRoots(cwd);
	if (!roots) return null;

	// A porcelain `worktree list` prints one "worktree <path>" line per
	// worktree, the main checkout included — more than one such line means at
	// least one linked worktree exists besides it. A failure here (e.g. an
	// old git without the subcommand) is read as "none", the safe direction:
	// this guard must not ask on a repo it cannot inspect.
	const list = tryGit(["worktree", "list", "--porcelain"], {
		cwd,
		env: withoutGitTargetEnvironment(),
	});
	const hasLinkedWorktrees = list.ok
		? list.out.split("\n").filter((line) => line.startsWith("worktree "))
				.length > 1
		: false;

	return {
		...roots,
		hasLinkedWorktrees,
	};
}

const { shouldOutput, output } = runVerificationTreeGuard(
	await readStdinText(),
	{
		resolveRoots,
		supportsAsk: supportsPermissionAsk(),
		payloadCwdIsExecutionCwd:
			typeof process.env.CLAUDE_PROJECT_DIR === "string" &&
			process.env.CLAUDE_PROJECT_DIR.trim() !== "",
		ambientGitTargetOverride: hasGitTargetEnvironment(),
		ambientCdPath:
			typeof process.env.CDPATH === "string" && process.env.CDPATH !== "",
	},
);
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
