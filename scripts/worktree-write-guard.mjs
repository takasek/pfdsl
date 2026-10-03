#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: checks actual Claude file_path and Codex
// apply_patch targets, allowing feature checkouts in the same repository.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// target is unresolved or on a protected branch; stays silent otherwise.
//
// Usage (wired in .claude/settings.json): node scripts/worktree-write-guard.mjs

import {
	buildPermissionOutput,
	parseHookPayload,
	readStdinText,
} from "./lib/hook-io.mjs";
import { evaluateWorktreeWriteGuard } from "./lib/worktree-write-guard.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

const result = evaluateWorktreeWriteGuard(payload);
if (result.decision === "deny") {
	console.log(JSON.stringify(buildPermissionOutput(result)));
}
process.exit(0);
