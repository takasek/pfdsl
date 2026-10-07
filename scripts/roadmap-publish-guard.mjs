#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: asks for `make release-status` before a new
// publish process is declared in roadmap.pfdsl (#650). See
// scripts/lib/roadmap-publish-guard.mjs for the detection logic, why this is
// ask rather than deny, and the stdin orchestration.
//
// Normal decisions exit 0. Uncaught policy loading or execution errors block with exit 2.
// Usage (wired in .claude/settings.json): node scripts/roadmap-publish-guard.mjs

try {
	const { readFileSync } = await import("node:fs");
	const { readStdinText } = await import("./lib/hook-io.mjs");
	const { runRoadmapPublishGuard } = await import(
		"./lib/roadmap-publish-guard.mjs"
	);

	/** The file as it stands, or undefined when it cannot be read (new file, no access). */
	function readFile(path) {
		try {
			return readFileSync(path, "utf8");
		} catch {
			return undefined;
		}
	}

	const { shouldOutput, output } = runRoadmapPublishGuard(
		await readStdinText(),
		{
			readFile,
		},
	);
	if (shouldOutput) {
		console.log(JSON.stringify(output));
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the roadmap-publish policy; repair policy loading before retrying.";
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
