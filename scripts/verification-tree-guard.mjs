#!/usr/bin/env node

// PreToolUse(Bash) hook: asks before a command whose target tree is implicit
// in cwd runs while this shell's cwd has drifted from its linked worktree
// back to the main checkout (#840). See scripts/lib/verification-tree-guard.mjs
// for the detection logic (which commands qualify and why) and why this is
// `ask`, not `deny`.
//
// Reads the hook payload on stdin. Prints an ask decision only when the cwd
// resolves to the main checkout, at least one linked worktree exists
// elsewhere in the repo, and the command contains a cwd-implicit segment;
// stays silent otherwise. Always exits 0 — a crash in this guard must not
// wedge every Bash call.
//
// Usage (wired in .claude/settings.json): node scripts/verification-tree-guard.mjs

import { dirname, resolve } from "node:path";
import {
	buildPermissionOutput,
	parseHookPayload,
	readStdinText,
} from "./lib/hook-io.mjs";
import { tryGit } from "./lib/run-exec.mjs";
import { evaluateVerificationTreeGuard } from "./lib/verification-tree-guard.mjs";

/**
 * @param {string} cwd
 * @returns {{worktreeRoot: string, mainRoot: string, hasLinkedWorktrees: boolean} | null}
 */
function resolveRoots(cwd) {
	const toplevel = tryGit(["rev-parse", "--show-toplevel"], { cwd });
	const commonDir = tryGit(["rev-parse", "--git-common-dir"], { cwd });
	if (!toplevel.ok || !commonDir.ok) return null;

	// A porcelain `worktree list` prints one "worktree <path>" line per
	// worktree, the main checkout included — more than one such line means at
	// least one linked worktree exists besides it. A failure here (e.g. an
	// old git without the subcommand) is read as "none", the safe direction:
	// this guard must not ask on a repo it cannot inspect.
	const list = tryGit(["worktree", "list", "--porcelain"], { cwd });
	const hasLinkedWorktrees = list.ok
		? list.out.split("\n").filter((line) => line.startsWith("worktree "))
				.length > 1
		: false;

	return {
		worktreeRoot: toplevel.out.trim(),
		mainRoot: dirname(resolve(cwd, commonDir.out.trim())),
		hasLinkedWorktrees,
	};
}

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

const cwd = payload?.cwd;
const roots = typeof cwd === "string" ? resolveRoots(cwd) : null;

const result = evaluateVerificationTreeGuard(payload, roots);
if (result.decision === "ask") {
	console.log(JSON.stringify(buildPermissionOutput(result)));
}
process.exit(0);
