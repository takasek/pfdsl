#!/usr/bin/env node
// PostToolUse(Write) hook: runs check-md-linebreaks.mjs against a .md file
// right after it is written (#650). See scripts/lib/md-write-check.mjs for
// why this catches the file individually instead of waiting for pre-commit.
//
// Reads the hook payload on stdin. Prints an advisory additionalContext only
// when the file has violations; stays silent otherwise. Always exits 0 —
// this never blocks anything, and a crash here must not wedge every Write.
//
// Usage (wired in .claude/settings.json): node scripts/md-write-check.mjs

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { tryRun } from "./lib/run-exec.mjs";
import { formatLinebreakAdvisory, isMarkdownWrite } from "./lib/md-write-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
	input += chunk;
}

let payload;
try {
	payload = JSON.parse(input);
} catch {
	process.exit(0);
}

if (!isMarkdownWrite(payload)) {
	process.exit(0);
}

const filePath = payload.tool_input.file_path;
const cwd = payload?.cwd ?? process.cwd();
const checkResult = tryRun("node", [resolve(root, "scripts/check-md-linebreaks.mjs"), filePath], { cwd });

const advisory = formatLinebreakAdvisory(filePath, checkResult);
if (advisory) {
	console.log(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: advisory,
			},
		}),
	);
}
process.exit(0);
