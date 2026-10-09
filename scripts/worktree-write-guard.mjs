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

// PreToolUse(Edit|Write) hook: denies a write whose file_path escapes the
// worktree this session's cwd is in (#357, #650). See
// scripts/lib/worktree-write-guard.mjs for the detection logic and why this
// resolves the worktree boundary via git rather than a path convention.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// target path is outside the worktree; stays silent otherwise.
// Uncaught policy loading or execution errors block with exit 2.
//
// Usage (wired in .claude/settings.json): node scripts/worktree-write-guard.mjs

try {
	const { buildPermissionOutput, parseHookPayload, readStdinText } =
		await import("./lib/hook-io.mjs");
	const { resolveGitRoots } = await import("./lib/run-exec.mjs");
	const { createGuardProbe } = await import("./lib/guard-probe.mjs");
	const { refineNativeWorktreeRelation } = await import(
		"./lib/native-worktree-owner.mjs"
	);
	const probeGit = createGuardProbe();
	const { evaluatePhysicalWrites } = await import(
		"./lib/file-operation-policy.mjs"
	);

	const payload = parseHookPayload(await readStdinText());
	if (!payload) process.exit(0);

	const cwd = process.env.CLAUDE_PROJECT_DIR?.trim() || payload?.cwd;
	const resolveRoots = (path) => resolveGitRoots(path, { exec: probeGit });
	const roots = typeof cwd === "string" ? resolveRoots(cwd) : null;

	const result = await evaluatePhysicalWrites(payload, roots, {
		resolveRoots,
		ownerRelation: (targetRoot, relation) =>
			refineNativeWorktreeRelation(relation, {
				targetRoot,
				payload,
				execGit: probeGit,
			}),
	});
	if (result.decision !== "allow") {
		console.log(JSON.stringify(buildPermissionOutput(result)));
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the worktree-write policy; repair the reported policy or file target condition before retrying.";
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
