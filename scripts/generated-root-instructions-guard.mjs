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

// PreToolUse(Edit|Write) hook: denies a direct edit of the generated root
// instructions documents CLAUDE.md / AGENTS.md (#1160). See
// scripts/lib/generated-root-instructions-guard.mjs for the detection logic
// and why this resolves the worktree root via git rather than a path
// convention.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// target is a worktree-root CLAUDE.md or AGENTS.md in the session repository; stays
// silent otherwise. Normal decisions exit 0.
// Uncaught policy loading or execution errors block with exit 2.
//
// Usage (wired in .claude/settings.json): node scripts/generated-root-instructions-guard.mjs

try {
	const {
		evaluateGeneratedRootInstructionsGuard,
		mayTargetGeneratedRootInstructions,
	} = await import("./lib/generated-root-instructions-guard.mjs");
	const { buildPermissionOutput, parseHookPayload, readStdinText } =
		await import("./lib/hook-io.mjs");
	const { resolveGitRoots } = await import("./lib/run-exec.mjs");
	const { createGuardProbe } = await import("./lib/guard-probe.mjs");
	const probeGit = createGuardProbe();
	const { normalizeFileOperations } = await import(
		"./lib/file-operation-policy.mjs"
	);

	const payload = parseHookPayload(await readStdinText());
	if (!payload) process.exit(0);

	// Name check first: only generated filenames need the session/target Git
	// boundary probes, which are synchronous and share the guard's budget.
	const operations = normalizeFileOperations(payload).filter((operation) =>
		mayTargetGeneratedRootInstructions(operation.tool_input.file_path),
	);
	if (!operations.length) process.exit(0);
	const cwd = process.env.CLAUDE_PROJECT_DIR?.trim() || payload.cwd;
	const sessionRoots =
		typeof cwd === "string" ? resolveGitRoots(cwd, { exec: probeGit }) : null;
	if (!sessionRoots)
		throw new Error("Cannot resolve generated instruction session repository");
	for (const operation of operations) {
		const { dirname } = await import("node:path");
		const roots = resolveGitRoots(dirname(operation.tool_input.file_path), {
			exec: probeGit,
		});
		// Scratch files and foreign repositories do not use this repo's template.
		// Unknown write boundaries remain the worktree-write policy's responsibility.
		if (!roots || roots.commonDir !== sessionRoots.commonDir) continue;
		const result = await evaluateGeneratedRootInstructionsGuard(
			operation,
			roots.worktreeRoot,
		);
		if (result.decision === "deny") {
			console.log(JSON.stringify(buildPermissionOutput(result)));
			process.exit(0);
		}
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the generated-root-instructions policy; repair policy loading before retrying.";
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
