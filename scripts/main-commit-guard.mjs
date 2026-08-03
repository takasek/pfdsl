#!/usr/bin/env node
// PreToolUse(Bash) hook: denies `git commit` while the current branch is the
// repo's default branch (#650). See scripts/lib/main-commit-guard.mjs for the
// detection logic, why this is deny rather than advisory, and the stdin
// orchestration.
//
// Both branch names come from git rather than being assumed: the current one
// from `git branch --show-current`, the default one from `origin/HEAD`. A repo
// whose default branch is `trunk` or `master` was previously guarded against a
// branch name it does not have. Neither is read unless the command turns out
// to be a commit — the lib calls resolveBranches only then.
//
// Always exits 0 — a crash here, or a `git` failure, must not wedge every Bash
// call.
//
// Usage (wired in .claude/settings.json): node scripts/main-commit-guard.mjs

import { tryGit } from "./lib/run-exec.mjs";
import { runMainCommitGuard } from "./lib/main-commit-guard.mjs";
import { readStdinText } from "./lib/hook-io.mjs";

/**
 * @param {object} payload PreToolUse hook payload
 * @returns {{currentBranch: string | undefined, mainBranch: string}}
 */
function resolveBranches(payload) {
	const cwd = payload?.cwd ?? process.cwd();
	const current = tryGit(["branch", "--show-current"], { cwd });
	const head = tryGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd });
	// `origin/main` -> `main`. Falling back to "main" keeps the guard working in
	// a clone whose origin/HEAD was never set. An undefined current branch
	// (detached HEAD, or git failing) makes the lib allow, which is the safe
	// direction: this guard must not wedge commits it cannot reason about.
	return {
		currentBranch: current.ok ? current.out.trim() : undefined,
		mainBranch: head.ok ? head.out.trim().replace(/^origin\//, "") : "main",
	};
}

const { shouldOutput, output } = runMainCommitGuard(await readStdinText(), { resolveBranches });
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
