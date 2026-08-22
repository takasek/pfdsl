#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: denies a write whose file_path escapes the
// worktree this session's cwd is in (#357, #650). See
// scripts/lib/worktree-write-guard.mjs for the detection logic and why this
// resolves the worktree boundary via git rather than a path convention.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// target path is outside the worktree; stays silent otherwise. Always exits
// 0 — a crash in this guard must not wedge every Edit/Write call.
//
// Usage (wired in .claude/settings.json): node scripts/worktree-write-guard.mjs

import {
	buildPermissionOutput,
	parseHookPayload,
	readStdinText,
} from "./lib/hook-io.mjs";
import { resolveGitRoots } from "./lib/run-exec.mjs";
import { evaluateWorktreeWriteGuard } from "./lib/worktree-write-guard.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

const cwd = payload?.cwd;
const roots = typeof cwd === "string" ? resolveGitRoots(cwd) : null;

const result = evaluateWorktreeWriteGuard(payload, roots);
if (result.decision === "deny") {
	console.log(JSON.stringify(buildPermissionOutput(result)));
}
process.exit(0);
