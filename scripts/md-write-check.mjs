#!/usr/bin/env node
// PostToolUse(Write|Edit) hook: runs check-md-linebreaks.mjs's check against a
// .md file right after it changes (#650). See scripts/lib/md-write-check.mjs
// for why this catches the file individually instead of waiting for pre-commit,
// and for the stdin orchestration.
//
// Always exits 0 — this never blocks anything.
//
// Usage (wired in .claude/settings.json): node scripts/md-write-check.mjs

import { checkFile, formatViolation } from "./check-md-linebreaks.mjs";
import { runMdWriteCheck } from "./lib/md-write-check.mjs";
import { readStdinText } from "./lib/hook-io.mjs";

const { shouldOutput, output } = runMdWriteCheck(await readStdinText(), { checkFile, formatViolation });
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
