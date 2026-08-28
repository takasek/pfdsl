#!/usr/bin/env node

// PreToolUse(Bash) hook: intervenes before a command whose target tree is
// implicit in cwd runs while this shell's cwd has drifted from its linked
// worktree back to the main checkout (#840). See
// scripts/lib/verification-tree-guard.mjs for the detection logic (which
// commands qualify and why) and the harness-specific decision.
//
// Reads the hook payload on stdin. Prints an ask decision for Claude Code or a
// deny decision for Codex only when the cwd resolves to the main checkout, at
// least one linked worktree exists elsewhere in the repo, and the command
// contains a cwd-implicit segment; stays silent otherwise. Codex cannot handle
// PreToolUse ask and would fail open, so deny tells it to retry with the linked
// worktree as harness workdir (#1013). Always exits 0 — a crash in this guard
// must not wedge every Bash call.
//
// Usage (wired in .claude/settings.json): node scripts/verification-tree-guard.mjs

import { readStdinText } from "./lib/hook-io.mjs";
import { resolveGitRoots, tryGit } from "./lib/run-exec.mjs";
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
	const list = tryGit(["worktree", "list", "--porcelain"], { cwd });
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
	},
);
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
