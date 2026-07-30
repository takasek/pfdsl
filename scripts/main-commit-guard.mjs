#!/usr/bin/env node
// PreToolUse(Bash) hook: denies `git commit` while the current branch is
// main (#650). See scripts/lib/main-commit-guard.mjs for the detection
// logic and why this is deny rather than advisory.
//
// Reads the hook payload on stdin, resolves the current branch via `git
// branch --show-current` (the payload does not carry it), and prints a
// deny decision only when both conditions hold. Always exits 0 — a crash
// here, or a `git branch` failure, must not wedge every Bash call.
//
// Usage (wired in .claude/settings.json): node scripts/main-commit-guard.mjs

import { tryGit } from "./lib/run-exec.mjs";
import { evaluateMainCommitGuard, isGitCommitCommand } from "./lib/main-commit-guard.mjs";
import { buildPermissionOutput, parseHookPayload, readStdinText } from "./lib/hook-io.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

// Re-checks what evaluateMainCommitGuard also checks, purely to skip the
// `git branch` subprocess on the common case (every non-commit Bash call).
// Kept in sync by hand — if the eligibility rule changes, update both.
if (payload?.tool_name !== "Bash" || !isGitCommitCommand(payload?.tool_input?.command)) {
	process.exit(0);
}

const cwd = payload?.cwd ?? process.cwd();
const branch = tryGit(["branch", "--show-current"], { cwd });
const currentBranch = branch.ok ? branch.out.trim() : undefined;

const result = evaluateMainCommitGuard(payload, { currentBranch });
if (result.decision === "deny") {
	console.log(JSON.stringify(buildPermissionOutput(result)));
}
process.exit(0);
