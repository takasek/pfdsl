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
import { buildDenyOutput, evaluateMainCommitGuard, isGitCommitCommand } from "./lib/main-commit-guard.mjs";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
	input += chunk;
}

let payload;
try {
	payload = JSON.parse(input);
} catch {
	process.exit(0);
}

// Skip the git call entirely when the command is not even a commit — the
// common case for every other Bash invocation this hook sees.
if (payload?.tool_name !== "Bash" || !isGitCommitCommand(payload?.tool_input?.command)) {
	process.exit(0);
}

const cwd = payload?.cwd ?? process.cwd();
const branch = tryGit(["branch", "--show-current"], { cwd });
const currentBranch = branch.ok ? branch.out.trim() : undefined;

const result = evaluateMainCommitGuard(payload, { currentBranch });
if (result.decision === "deny") {
	console.log(JSON.stringify(buildDenyOutput(result)));
}
process.exit(0);
