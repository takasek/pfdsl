#!/usr/bin/env node
// PreToolUse(Bash) hook: catches command usages that mislead the caller rather
// than fail loudly — `npx @pfdsl/cli` (ask) and `gh issue view --comments`
// (deny) (#650). See scripts/lib/command-usage-guard.mjs for the detection
// logic, why each rule lands on that decision, and the stdin orchestration.
//
// Always exits 0 — a crash in this guard must not wedge every Bash call.
//
// Usage (wired in .claude/settings.json): node scripts/command-usage-guard.mjs

import { runCommandUsageGuard } from "./lib/command-usage-guard.mjs";
import { readStdinText } from "./lib/hook-io.mjs";

const { shouldOutput, output } = runCommandUsageGuard(await readStdinText());
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
