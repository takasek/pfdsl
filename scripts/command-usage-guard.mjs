#!/usr/bin/env node
// PreToolUse(Bash) hook: catches command usages that mislead the caller rather
// than fail loudly — `npx @pfdsl/cli` (ask) and `gh issue view --comments`
// (deny) (#650). See scripts/lib/command-usage-guard.mjs for the detection
// logic and why each rule lands on that decision.
//
// Reads the hook payload on stdin. Prints a decision only when a rule matches;
// stays silent otherwise. Always exits 0 — a crash in this guard must not wedge
// every Bash call.
//
// Usage (wired in .claude/settings.json): node scripts/command-usage-guard.mjs

import { evaluateCommandUsageGuard } from "./lib/command-usage-guard.mjs";
import { buildPermissionOutput, parseHookPayload, readStdinText } from "./lib/hook-io.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

const result = evaluateCommandUsageGuard(payload);
if (result.decision !== "allow") {
	console.log(JSON.stringify(buildPermissionOutput(result)));
}
process.exit(0);
