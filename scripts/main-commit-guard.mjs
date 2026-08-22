#!/usr/bin/env node

// PreToolUse(Bash) hook: denies or prompts for git commands that change the
// default branch or another worktree owned by the same repository (#650,
// widened beyond `git commit` in #777 and across worktrees in #784). See
// scripts/lib/main-commit-guard.mjs for the detection logic, which subcommand
// gets which decision and why, and the stdin orchestration.
//
// Both branch names come from git rather than being assumed: the current one
// from `git branch --show-current`, the default one from `origin/HEAD`. A repo
// whose default branch is `trunk` or `master` was previously guarded against a
// branch name it does not have. Worktree ownership is anchored to the fixed
// CLAUDE_PROJECT_DIR and compared with the command target's git roots. None of
// these are read unless the command turns out to be guarded — the lib calls
// resolveBranches only then.
//
// Always exits 0 — a crash here, or a `git` failure, must not wedge every Bash
// call.
//
// Usage (wired in .claude/settings.json): node scripts/main-commit-guard.mjs

import { readStdinText } from "./lib/hook-io.mjs";
import {
	crossesWorktree,
	resolveCommandCwd,
	runMainCommitGuard,
} from "./lib/main-commit-guard.mjs";
import { resolveGitRoots, tryGit } from "./lib/run-exec.mjs";

/**
 * @param {object} payload PreToolUse hook payload
 * @returns {{currentBranch: string | undefined, mainBranch: string, crossesWorktree: boolean}}
 */
function resolveBranches(payload) {
	// The command's own tree, not the shell's: a `cd` or `git -C` in the command
	// decides which tree it acts on, and the hook runs before either takes
	// effect (#751).
	const targetCwd = resolveCommandCwd(
		payload?.tool_input?.command,
		payload?.cwd ?? process.cwd(),
	);
	const targetRoots = resolveGitRoots(targetCwd);
	const projectDir = process.env.CLAUDE_PROJECT_DIR;
	const sessionRoots =
		typeof projectDir === "string" ? resolveGitRoots(projectDir) : null;
	const current = tryGit(["branch", "--show-current"], { cwd: targetCwd });
	const head = tryGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
		cwd: targetCwd,
	});
	// `origin/main` -> `main`. Falling back to "main" keeps the guard working in
	// a clone whose origin/HEAD was never set. An undefined current branch
	// (detached HEAD, or git failing) makes the lib allow, which is the safe
	// direction: this guard must not wedge commits it cannot reason about.
	return {
		currentBranch: current.ok ? current.out.trim() : undefined,
		mainBranch: head.ok ? head.out.trim().replace(/^origin\//, "") : "main",
		crossesWorktree: crossesWorktree(sessionRoots, targetRoots),
	};
}

const { shouldOutput, output } = runMainCommitGuard(await readStdinText(), {
	resolveBranches,
});
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
