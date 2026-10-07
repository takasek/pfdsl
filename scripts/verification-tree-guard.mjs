#!/usr/bin/env node

// PreToolUse(Bash) hook: intervenes before a command whose target tree is
// implicit in cwd runs while the hook reports the main checkout of a
// repository with linked worktrees (#840). See
// scripts/lib/verification-tree-guard.mjs for the detection logic (which
// commands qualify and why) and the harness-specific decision.
//
// Reads the hook payload on stdin. Prints an ask decision for Claude Code or a
// deny decision for Codex only when the cwd resolves to the main checkout, at
// least one linked worktree exists elsewhere in the repo, and the command
// contains a cwd-implicit segment; stays silent otherwise. Codex cannot handle
// PreToolUse ask and would fail open, so deny points to approved explicit-target
// recovery paths (#1013, #1392). Changing only execution workdir cannot recover
// an unchanged payload.cwd. Normal decisions exit 0.
// Uncaught policy loading or execution errors block with exit 2.
//
// Usage (wired in .claude/settings.json): node scripts/verification-tree-guard.mjs

try {
	const { readStdinText } = await import("./lib/hook-io.mjs");
	const { resolveGitRoots, tryGit } = await import("./lib/run-exec.mjs");
	const { runVerificationTreeGuard, supportsPermissionAsk } = await import(
		"./lib/verification-tree-guard.mjs"
	);

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
} catch (error) {
	const reason =
		"Cannot execute the verification-tree policy; repair policy loading before retrying.";
	console.error(
		`${reason} ${error instanceof Error ? error.message : String(error)}`,
	);
	console.log(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		}),
	);
	process.exit(2);
}
