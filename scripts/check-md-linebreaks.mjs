#!/usr/bin/env node
/**
 * check-md-linebreaks.mjs
 *
 * Detects mid-sentence line breaks in markdown prose and list-item continuations.
 * A line break is a violation when the preceding line does not end at a sentence
 * boundary (Japanese punctuation 。、！？…, English .!?:, or closing brackets).
 *
 * Skips:
 *   - fenced code blocks (``` or ~~~)
 *   - sub-bullet lines (the continuation itself starts with a list marker)
 *   - continuations preceded by a blank line (indented code block / loose list para)
 *
 * Usage:
 *   node scripts/check-md-linebreaks.mjs [files...]
 *   (no args → all git-tracked *.md files)
 *
 * Exit 0 = clean, Exit 1 = violations found.
 */

import { readFileSync } from "node:fs";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import { checkFile as checkFileText } from "./lib/md-linebreaks.mjs";
import { runMdLinebreaksCheck } from "./lib/md-linebreaks-steps.mjs";
import { git } from "./lib/run-exec.mjs";

/**
 * Reads filePath and runs lib/md-linebreaks.mjs's pure checkFile against it.
 * Kept here (rather than inlined at each call site) so scripts/md-write-check.mjs
 * can import a single file-path-in, violations-out entry point in-process (#650).
 */
export function checkFile(filePath) {
	return checkFileText(filePath, readFileSync(filePath, "utf8"));
}

/** Formats one violation the way the CLI prints it — shared with md-write-check.mjs (#650). */
export function formatViolation(v) {
	return `${v.file}:${v.line}: mid-sentence line break\n  prev: …${v.prev.slice(-80)}\n  cont: ${v.cont.slice(0, 80)}`;
}

// CLI mode: `node scripts/check-md-linebreaks.mjs [files...]`. Guarded so
// scripts/lib/md-write-check.mjs can import checkFile/formatViolation
// in-process without spawning this as a subprocess.
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	const args = process.argv.slice(2);
	const listFiles = () =>
		git(["ls-files", "*.md"]).trim().split("\n").filter(Boolean);

	const { exitCode, messages } = runMdLinebreaksCheck({
		args,
		listFiles,
		readFile: (file) => readFileSync(file, "utf8"),
	});
	for (const { stream, text } of messages) {
		if (stream === "log") console.log(text);
		else console.error(text);
	}
	process.exit(exitCode);
}
