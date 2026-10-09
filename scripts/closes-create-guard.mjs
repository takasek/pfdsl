#!/usr/bin/env node

import { isMainThread } from "node:worker_threads";

if (isMainThread) {
	try {
		const { supervisePolicy } = await import("./lib/policy-supervisor.mjs");
		await supervisePolicy(new URL(import.meta.url));
	} catch (error) {
		const reason = `Cannot start the policy supervisor: ${error instanceof Error ? error.message : String(error)}. Repair the hook before retrying.`;
		console.error(reason);
		console.log(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: reason,
				},
			}),
		);
		process.exit(2);
	}
}

// PreToolUse(Bash) hook: catches `gh pr create` calls bound for the default
// branch whose body carries no evidence they close an issue (#871). See
// scripts/lib/closes-create-guard.mjs for the detection logic and why it
// lands on "ask" rather than "deny" or "allow".
//
// Normal decisions exit 0. Uncaught policy loading or execution errors block with exit 2.
// Usage (wired in .claude/settings.json): node scripts/closes-create-guard.mjs

try {
	const { tryGit } = await import("./lib/run-exec.mjs");
	const { createGuardProbe } = await import("./lib/guard-probe.mjs");
	const probeGit = createGuardProbe({ exec: tryGit });
	const { readFileSync } = await import("node:fs");

	const { runClosesCreateGuard } = await import(
		"./lib/closes-create-guard.mjs"
	);
	const { readStdinText } = await import("./lib/hook-io.mjs");

	/**
	 * The repo's default branch name, resolved from origin's HEAD symref.
	 * Falls back to "main" when it cannot be resolved (e.g. origin/HEAD was
	 * never set locally) — guessing the common case is safer here than treating
	 * an unresolved default branch as "no PR ever targets the default branch".
	 * @returns {string}
	 */
	function resolveDefaultBranch() {
		const ref = probeGit([
			"symbolic-ref",
			"--short",
			"refs/remotes/origin/HEAD",
		]);
		return ref.ok ? ref.out.trim().replace(/^origin\//, "") : "main";
	}

	const { shouldOutput, output } = await runClosesCreateGuard(
		await readStdinText(),
		{
			supportsAsk: Boolean(process.env.CLAUDE_PROJECT_DIR?.trim()),
			getDefaultBranch: resolveDefaultBranch,
			readFile: (path) => readFileSync(path, "utf8"),
		},
	);
	if (shouldOutput) {
		console.log(JSON.stringify(output));
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the closes-create policy; repair policy loading before retrying.";
	console.error(
		`${reason} ${error instanceof Error ? error.message : String(error)}`,
	);
	console.log(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		}),
	);
	process.exit(2);
}
