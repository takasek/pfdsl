#!/usr/bin/env node
/**
 * check-entry-path-headings.mjs
 *
 * Fails when a markdown heading names the slash command its section is reached
 * by, instead of the section's content. See scripts/lib/entry-path-headings.mjs
 * for why that costs a reader the whole section.
 *
 * Scope is every tracked *.md file: the defect is about how a heading reads,
 * which does not depend on whether the file ships. Commands are named freely in
 * body prose — only headings are examined.
 *
 * Usage:
 *   node scripts/check-entry-path-headings.mjs [files...]
 *   (no args → all git-tracked *.md files)
 *
 * Exit 0 = clean, Exit 1 = violations found.
 */

import { readFileSync } from "node:fs";
import { findEntryPathHeadings } from "./lib/entry-path-headings.mjs";
import { gitLsFiles } from "./lib/run-exec.mjs";

const args = process.argv.slice(2);
const paths = args.length > 0 ? args : gitLsFiles(["*.md"]);

const found = findEntryPathHeadings(
	paths.map((path) => ({ path, content: readFileSync(path, "utf-8") })),
);

if (found.length > 0) {
	console.error(
		"check-entry-path-headings: headings named after an entry path:",
	);
	for (const f of found)
		console.error(`  ${f.path}:${f.line}: names ${f.command}\n    ${f.text}`);
	console.error(
		"\nA reader who arrived some other way reads such a heading as out of scope",
	);
	console.error(
		"and skips the section. Name what the section contains; list no entry paths.",
	);
	process.exit(1);
}

console.log(`check-entry-path-headings: OK (${paths.length} file(s))`);
