#!/usr/bin/env node
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
	const { evaluateWorktreeWriteGuard } = await import(
		"./lib/worktree-write-guard.mjs"
	);

	const payload = parseHookPayload(await readStdinText());
	if (!payload) process.exit(0);

	const cwd = payload?.cwd;
	const roots = typeof cwd === "string" ? resolveGitRoots(cwd) : null;

	const result = evaluateWorktreeWriteGuard(payload, roots);
	if (result.decision === "deny") {
		console.log(JSON.stringify(buildPermissionOutput(result)));
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the worktree-write policy; repair policy loading before retrying.";
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
