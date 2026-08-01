#!/usr/bin/env node
// PreToolUse(Bash) hook: refuses outward-facing commands (push, PR/issue
// mutation) issued by a delegated subagent (#554). See
// scripts/lib/delegation-guard.mjs for why this lives in a hook rather than
// in agent frontmatter or settings permissions.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// command is outward-facing AND the caller is a non-allowlisted subagent;
// stays silent otherwise. Always exits 0 — a crash in this guard must not
// wedge every Bash call, so anything unparseable is allowed through and the
// caller's return-time check remains the backstop.
//
// Usage (wired in .claude/settings.json): node scripts/delegation-guard.mjs

import { runDelegationGuard } from "./lib/delegation-guard.mjs";
import { readStdinText } from "./lib/hook-io.mjs";

const { shouldOutput, output } = runDelegationGuard(await readStdinText());
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
