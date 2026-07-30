#!/usr/bin/env node
// PostToolUse(Write) hook: runs check-md-linebreaks.mjs's check against a
// .md file right after it is written (#650). See scripts/lib/md-write-check.mjs
// for why this catches the file individually instead of waiting for pre-commit.
//
// Reads the hook payload on stdin. Prints an advisory additionalContext only
// when the file has violations; stays silent otherwise. Always exits 0 —
// this never blocks anything, and a crash here must not wedge every Write.
//
// Usage (wired in .claude/settings.json): node scripts/md-write-check.mjs

import { checkFile, formatViolation } from "./check-md-linebreaks.mjs";
import { formatLinebreakAdvisory, isMarkdownWrite } from "./lib/md-write-check.mjs";
import { buildAdvisoryOutput, parseHookPayload, readStdinText } from "./lib/hook-io.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload || !isMarkdownWrite(payload)) {
	process.exit(0);
}

const filePath = payload.tool_input.file_path;
let violations;
try {
	violations = checkFile(filePath);
} catch {
	// The file may already be gone or unreadable by the time this runs — not
	// this hook's problem to report.
	process.exit(0);
}

const advisory = formatLinebreakAdvisory(filePath, violations, formatViolation);
if (advisory) {
	console.log(JSON.stringify(buildAdvisoryOutput(advisory)));
}
process.exit(0);
