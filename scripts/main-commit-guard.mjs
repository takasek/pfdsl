#!/usr/bin/env node

// PreToolUse(Bash) hook: denies or prompts for Git commands that change the
// default branch, and denies hook bypasses within repository scope. See
// scripts/lib/main-commit-guard.mjs for the detection logic, which subcommand
// gets which decision and why, and the stdin orchestration.
//
// Both branch names come from git rather than being assumed: the current one
// from `git branch --show-current`, the default one from `origin/HEAD`. A repo
// whose default branch is `trunk` or `master` was previously guarded against a
// branch name it does not have. Repository scope is anchored to the harness
// session root: CLAUDE_PROJECT_DIR in Claude Code and payload cwd in Codex.
// This is separate from effective shell cwd, which Codex does not provide.
// The lib resolves each command target, and calls resolveBranches only for
// guarded commands. A different worktree root does not establish ownership.
//
// Always exits 0 — a crash here, or a `git` failure, must not wedge every Bash
// call.
//
// Usage (wired in .claude/settings.json and .codex/hooks.json): node scripts/main-commit-guard.mjs

import { realpathSync } from "node:fs";
import { readStdinText } from "./lib/hook-io.mjs";
import {
	classifyTargetRepository,
	runMainCommitGuard,
} from "./lib/main-commit-guard.mjs";
import {
	hasGitTargetEnvironment,
	resolveGitRoots,
	tryGit,
	withoutGitTargetEnvironment,
} from "./lib/run-exec.mjs";

function physicalGitRoots(cwd) {
	const roots = resolveGitRoots(cwd);
	if (roots === null) return null;
	try {
		return { ...roots, commonDir: realpathSync.native(roots.commonDir) };
	} catch {
		// Failed identity lookup is unknown, never proof of foreign scope.
		return null;
	}
}

/**
 * @param {object} payload PreToolUse hook payload
 * @param {string} targetCwd resolved cwd of one guarded Git segment
 * @returns {{currentBranch: string | undefined, mainBranch: string, targetRelation: "same" | "foreign" | "unknown"}}
 */
function resolveBranches(payload, targetCwd) {
	// Each guarded segment supplies its own target, so a compound command that
	// changes cwd is checked against every worktree it reaches (#751, #784).
	try {
		// Canonicalize before resolveGitRoots combines cwd with a relative
		// common-dir. Lexically folding a symlink/.. pair can misclassify the
		// protected repository as foreign even when Git itself reaches main.
		targetCwd = realpathSync.native(targetCwd);
	} catch {
		// Retain the existing unknown-target path when the directory cannot
		// be read; a failed root lookup is not evidence of foreign scope.
	}
	const targetRoots = physicalGitRoots(targetCwd);
	const projectDir = process.env.CLAUDE_PROJECT_DIR;
	const payloadCwd = payload?.cwd;
	let sessionDir =
		typeof projectDir === "string" && projectDir.trim() !== ""
			? projectDir
			: typeof payloadCwd === "string" && payloadCwd.trim() !== ""
				? payloadCwd
				: null;
	if (sessionDir !== null) {
		try {
			// Repository scope needs the same physical-path handling as the
			// command target, including a session cwd containing symlink/...
			sessionDir = realpathSync.native(sessionDir);
		} catch {
			// A failed session lookup remains unknown repository scope.
		}
	}
	const sessionRoots =
		sessionDir === null ? null : physicalGitRoots(sessionDir);
	const identityEnv = withoutGitTargetEnvironment();
	const current = tryGit(["branch", "--show-current"], {
		cwd: targetCwd,
		env: identityEnv,
	});
	const head = tryGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
		cwd: targetCwd,
		env: identityEnv,
	});
	// `origin/main` -> `main`. Falling back to "main" keeps the guard working in
	// a clone whose origin/HEAD was never set. An undefined current branch
	// (detached HEAD, or git failing) makes the lib allow, which is the safe
	// direction: this guard must not wedge commits it cannot reason about.
	return {
		currentBranch: current.ok ? current.out.trim() : undefined,
		mainBranch: head.ok ? head.out.trim().replace(/^origin\//, "") : "main",
		targetRelation: classifyTargetRepository(sessionRoots, targetRoots),
	};
}

const { shouldOutput, output } = runMainCommitGuard(await readStdinText(), {
	resolveBranches,
	ambientGitTargetOverride: hasGitTargetEnvironment(),
	ambientCdPath:
		typeof process.env.CDPATH === "string" && process.env.CDPATH !== "",
	payloadCwdIsExecutionCwd:
		typeof process.env.CLAUDE_PROJECT_DIR === "string" &&
		process.env.CLAUDE_PROJECT_DIR.trim() !== "",
	supportsAsk:
		typeof process.env.CLAUDE_PROJECT_DIR === "string" &&
		process.env.CLAUDE_PROJECT_DIR.trim() !== "",
});
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
