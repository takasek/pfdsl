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
 *   - breaks with markdown structure on either side: heading, table row,
 *     blockquote, raw HTML (#770 — these end on non-boundary characters, so
 *     without the skip every line next to them would report a violation)
 *
 * Usage:
 *   node scripts/check-md-linebreaks.mjs [files...]
 *   (no args → all git-tracked *.md files)
 *   node scripts/check-md-linebreaks.mjs --staged
 *   (only staged *.md files, reading their index contents)
 *
 * Exit 0 = clean, Exit 1 = violations found.
 */

import { readFileSync } from "node:fs";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import { checkFile as checkFileText } from "./lib/md-linebreaks.mjs";
import { runMdLinebreaksCheck } from "./lib/md-linebreaks-steps.mjs";
import { git, gitDiffNames, gitLsFiles } from "./lib/run-exec.mjs";

/**
 * Reads filePath and runs lib/md-linebreaks.mjs's pure checkFile against it.
 */
export function checkFile(filePath) {
	return checkFileText(filePath, readFileSync(filePath, "utf8"));
}

/** Formats one violation for the CLI. */
export function formatViolation(v) {
	return `${v.file}:${v.line}: mid-sentence line break\n  prev: …${v.prev.slice(-80)}\n  cont: ${v.cont.slice(0, 80)}`;
}

// CLI mode: `node scripts/check-md-linebreaks.mjs [files...]`.
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	const args = process.argv.slice(2);
	const staged = args[0] === "--staged";
	if (staged && args.length !== 1) {
		console.error(
			"--staged checks all staged Markdown files; do not pass paths.",
		);
		process.exit(1);
	}
	if (args[0] === "--") args.shift();
	const listFiles = () =>
		staged
			? gitDiffNames(["--cached", "--diff-filter=d", "--", "*.md"])
			: gitLsFiles(["*.md"]);

	const { exitCode, messages } = runMdLinebreaksCheck({
		args: staged ? [] : args,
		listFiles,
		// Keep Git's hook environment, including GIT_INDEX_FILE: commits that
		// supply an alternate index must check the same content they will write.
		// Explicit stage 0 keeps a filename like 0:foo.md from selecting foo.md.
		readFile: (file) =>
			staged ? git(["show", `:0:${file}`]) : readFileSync(file, "utf8"),
	});
	for (const { stream, text } of messages) {
		if (stream === "log") console.log(text);
		else console.error(text);
	}
	process.exit(exitCode);
}
