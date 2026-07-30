#!/usr/bin/env node
// PostToolUse(Bash) hook: after a successful `gh issue create --label
// flow:managed`, asks for the matching artifact in .pfdsl/roadmap.pfdsl (#650).
// See scripts/lib/managed-issue-reminder.mjs for why this fires at creation
// time rather than being left to gate-check.
//
// Reads the hook payload on stdin. Prints an advisory additionalContext only
// for a successful managed create; stays silent otherwise. Always exits 0 —
// this never blocks anything.
//
// Usage (wired in .claude/settings.json): node scripts/managed-issue-reminder.mjs

import { formatManagedIssueAdvisory } from "./lib/managed-issue-reminder.mjs";
import { buildAdvisoryOutput, parseHookPayload, readStdinText } from "./lib/hook-io.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

const advisory = formatManagedIssueAdvisory(payload);
if (advisory) {
	console.log(JSON.stringify(buildAdvisoryOutput(advisory)));
}
process.exit(0);
