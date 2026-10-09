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

// PreToolUse(Edit|Write) hook: asks for `make release-status` before a new
// publish process is declared in roadmap.pfdsl (#650). See
// scripts/lib/roadmap-publish-guard.mjs for the detection logic, why this is
// ask rather than deny, and the stdin orchestration.
//
// Normal decisions exit 0. Uncaught policy loading or execution errors block with exit 2.
// Usage (wired in .claude/settings.json): node scripts/roadmap-publish-guard.mjs

try {
	const { readFileSync } = await import("node:fs");
	const { readStdinText, parseHookPayload, buildPermissionOutput } =
		await import("./lib/hook-io.mjs");
	const { normalizeFileOperations } = await import(
		"./lib/file-operation-policy.mjs"
	);
	const { evaluateRoadmapPublishGuard } = await import(
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

	const payload = parseHookPayload(await readStdinText());
	if (!payload) process.exit(0);
	for (const operation of normalizeFileOperations(payload)) {
		const result = await evaluateRoadmapPublishGuard(operation, { readFile });
		if (result.decision === "allow") continue;
		// Codex cannot ask. Preserve the advisory without pretending it prevents
		// this write; release publication itself stays a separate human decision.
		if (!process.env.CLAUDE_PROJECT_DIR?.trim()) {
			console.log(
				JSON.stringify({
					hookSpecificOutput: {
						hookEventName: "PreToolUse",
						additionalContext: result.reason,
					},
				}),
			);
		} else console.log(JSON.stringify(buildPermissionOutput(result)));
		break;
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
