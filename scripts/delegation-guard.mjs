#!/usr/bin/env node
// PreToolUse(Bash) hook: refuses outward-facing commands (push, PR/issue
// mutation) issued by a delegated subagent (#554). See
// scripts/lib/delegation-guard.mjs for why this lives in a hook rather than
// in agent frontmatter or settings permissions.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// command is outward-facing AND the caller is a non-allowlisted subagent;
// stays silent otherwise. Normal decisions exit 0.
// Uncaught policy loading or execution errors block with exit 2.
//
// Usage (wired in .claude/settings.json): node scripts/delegation-guard.mjs

try {
	const { runDelegationGuard } = await import("./lib/delegation-guard.mjs");
	const { readStdinText } = await import("./lib/hook-io.mjs");

	const { shouldOutput, output } = runDelegationGuard(await readStdinText());
	if (shouldOutput) {
		console.log(JSON.stringify(output));
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the delegation policy; repair policy loading before retrying.";
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
