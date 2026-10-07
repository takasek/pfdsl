#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: denies a direct edit of the generated root
// instructions documents CLAUDE.md / AGENTS.md (#1160). See
// scripts/lib/generated-root-instructions-guard.mjs for the detection logic
// and why this resolves the worktree root via git rather than a path
// convention.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// target is the session's own worktree-root CLAUDE.md or AGENTS.md; stays
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
