#!/usr/bin/env node
// PreToolUse(Bash) hook: catches `gh pr create` calls bound for the default
// branch whose body carries no evidence they close an issue (#871). See
// scripts/lib/closes-create-guard.mjs for the detection logic and why it
// lands on "ask" rather than "deny" or "allow".
//
// Always exits 0 — a crash in this guard must not wedge every Bash call.
//
// Usage (wired in .claude/settings.json): node scripts/closes-create-guard.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { runClosesCreateGuard } from "./lib/closes-create-guard.mjs";
import { readStdinText } from "./lib/hook-io.mjs";

/**
 * The repo's default branch name, resolved from origin's HEAD symref.
 * Falls back to "main" when it cannot be resolved (e.g. origin/HEAD was
 * never set locally) — guessing the common case is safer here than treating
 * an unresolved default branch as "no PR ever targets the default branch".
 * @returns {string}
 */
function resolveDefaultBranch() {
	try {
		const ref = execFileSync(
			"git",
			["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
			{ encoding: "utf8" },
		).trim();
		return ref.replace(/^origin\//, "");
	} catch {
		return "main";
	}
}

const { shouldOutput, output } = runClosesCreateGuard(await readStdinText(), {
	getDefaultBranch: resolveDefaultBranch,
	readFile: (path) => readFileSync(path, "utf8"),
});
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
