#!/usr/bin/env node
// Advisory-only reminder for scripts/pre-commit: warn on stderr when a
// staged commit adds a `status: done` line to .pfdsl/roadmap.pfdsl, as a
// just-in-time nudge to consider running pfd-retro (#463). Detection is a
// coarse regex on added diff lines — false positives near existing done
// blocks are acceptable since the message says "if needed" and the check
// never blocks the commit (exit 0 always).
import { isCliEntrypoint } from "./cli-entrypoint.mjs";
import { git } from "./run-exec.mjs";

const DONE_ADDITION_PATTERN = /^\+(?!\+\+).*status:\s*done/;

export function detectDoneAddition(diffText) {
	return diffText.split("\n").some((line) => DONE_ADDITION_PATTERN.test(line));
}

// CLI mode: read the staged diff for roadmap.pfdsl, print an advisory
// warning to stderr if a status: done addition is found. Always exits 0 —
// this is a reminder, not a gate.
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	const diff = git(["diff", "--cached", "--", ".pfdsl/roadmap.pfdsl"]);
	if (detectDoneAddition(diff)) {
		console.error(
			"note: this commit marks a roadmap artifact done — run pfd-retro if warranted.",
		);
	}
	process.exit(0);
}
