#!/usr/bin/env node

// PostToolUse(Bash) hook: after a successful `gh issue create --label
// flow:managed`, asks for the matching artifact in .pfdsl/roadmap.pfdsl (#650).
// See scripts/lib/managed-issue-reminder.mjs for why this fires at creation
// time rather than being left to gate-check, and for the stdin orchestration.
//
// Always exits 0 — this never blocks anything.
//
// Usage (wired in .claude/settings.json): node scripts/managed-issue-reminder.mjs

import { readStdinText } from "./lib/hook-io.mjs";
import { runManagedIssueReminder } from "./lib/managed-issue-reminder.mjs";

const { shouldOutput, output } = runManagedIssueReminder(await readStdinText());
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
