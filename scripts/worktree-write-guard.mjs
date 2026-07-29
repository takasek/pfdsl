#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: denies a write whose file_path escapes the
// worktree this session's cwd is in (#357, #650). See
// scripts/lib/worktree-write-guard.mjs for the detection logic and why this
// is deny rather than advisory.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// target path is outside the worktree; stays silent otherwise. Always exits
// 0 — a crash in this guard must not wedge every Edit/Write call.
//
// Usage (wired in .claude/settings.json): node scripts/worktree-write-guard.mjs

import { buildDenyOutput, evaluateWorktreeWriteGuard } from "./lib/worktree-write-guard.mjs";

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

const result = evaluateWorktreeWriteGuard(payload);
if (result.decision === "deny") {
	console.log(JSON.stringify(buildDenyOutput(result)));
}
process.exit(0);
