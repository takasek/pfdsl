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

import { dirname, resolve } from "node:path";

import { evaluateWorktreeWriteGuard } from "./lib/worktree-write-guard.mjs";
import { buildDenyOutput, parseHookPayload, readStdinText } from "./lib/hook-io.mjs";
import { tryGit } from "./lib/run-exec.mjs";

/**
 * @param {string} cwd
 * @returns {{worktreeRoot: string, mainRoot: string} | null}
 */
function resolveRoots(cwd) {
	const toplevel = tryGit(["rev-parse", "--show-toplevel"], { cwd });
	const commonDir = tryGit(["rev-parse", "--git-common-dir"], { cwd });
	if (!toplevel.ok || !commonDir.ok) return null;
	return {
		worktreeRoot: toplevel.out.trim(),
		mainRoot: dirname(resolve(cwd, commonDir.out.trim())),
	};
}

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

const cwd = payload?.cwd;
const roots = typeof cwd === "string" ? resolveRoots(cwd) : null;

const result = evaluateWorktreeWriteGuard(payload, roots);
if (result.decision === "deny") {
	console.log(JSON.stringify(buildDenyOutput(result)));
}
process.exit(0);
