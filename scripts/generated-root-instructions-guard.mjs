#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: denies a direct edit of the generated root
// instructions documents CLAUDE.md / AGENTS.md (#1160). See
// scripts/lib/generated-root-instructions-guard.mjs for the detection logic
// and why this resolves the worktree root via git rather than a path
// convention.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// target is the session's own worktree-root CLAUDE.md or AGENTS.md; stays
// silent otherwise. Always exits 0 — a crash in this guard must not wedge
// every Edit/Write call.
//
// Usage (wired in .claude/settings.json): node scripts/generated-root-instructions-guard.mjs

import {
	evaluateGeneratedRootInstructionsGuard,
	mayTargetGeneratedRootInstructions,
} from "./lib/generated-root-instructions-guard.mjs";
import {
	buildPermissionOutput,
	parseHookPayload,
	readStdinText,
} from "./lib/hook-io.mjs";
import { resolveGitRoots } from "./lib/run-exec.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

// Name check first: resolving the worktree root costs two git subprocesses,
// paid synchronously on every Edit/Write, and only two filenames can ever
// reach a deny.
if (!mayTargetGeneratedRootInstructions(payload?.tool_input?.file_path))
	process.exit(0);

const cwd = payload?.cwd;
const roots = typeof cwd === "string" ? resolveGitRoots(cwd) : null;

const result = evaluateGeneratedRootInstructionsGuard(
	payload,
	roots?.worktreeRoot ?? null,
);
if (result.decision === "deny") {
	console.log(JSON.stringify(buildPermissionOutput(result)));
}
process.exit(0);
