#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: asks for `make release-status` before a new
// publish process is declared in roadmap.pfdsl (#650). See
// scripts/lib/roadmap-publish-guard.mjs for the detection logic and why this is
// ask rather than deny.
//
// Reads the hook payload on stdin. Prints an ask decision only when the change
// declares a publish process the replaced text did not; stays silent otherwise.
// Always exits 0 — a crash in this guard must not wedge every Edit/Write call.
//
// Usage (wired in .claude/settings.json): node scripts/roadmap-publish-guard.mjs

import { evaluateRoadmapPublishGuard } from "./lib/roadmap-publish-guard.mjs";
import { buildPermissionOutput, parseHookPayload, readStdinText } from "./lib/hook-io.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

const result = evaluateRoadmapPublishGuard(payload);
if (result.decision !== "allow") {
	console.log(JSON.stringify(buildPermissionOutput(result)));
}
process.exit(0);
