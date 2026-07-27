#!/usr/bin/env node
/**
 * check-no-shell-strings.mjs
 *
 * Fails when a script can run a command through a shell. These scripts take
 * refs, artifact keys, tags and paths from argv and from other commands'
 * output, and a shell parses whatever is spliced into the command line — a
 * space word-splits and a semicolon starts another command (#571 found this in
 * review-measurement, #572 in gate-check and cycle-status).
 *
 * Use `scripts/lib/run-exec.mjs`, which names the executable and its arguments
 * separately.
 *
 * Usage: node scripts/check-no-shell-strings.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findShellExecutors } from "./lib/check-no-shell-strings.mjs";
import { git } from "./lib/run-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Both patterns are needed: "scripts/**/*.mjs" misses scripts/*.mjs itself.
const files = git(["ls-files", "scripts/*.mjs", "scripts/**/*.mjs"], { cwd: root })
	.trim()
	.split("\n")
	.filter(Boolean)
	.filter((f, i, arr) => arr.indexOf(f) === i)
	// The detector and its tests hold the offending patterns as data.
	.filter((f) => !f.endsWith(".test.mjs"))
	.filter((f) => f !== "scripts/lib/check-no-shell-strings.mjs");

const findings = [];
for (const file of files) {
	for (const finding of findShellExecutors(readFileSync(resolve(root, file), "utf-8"))) {
		findings.push({ file, ...finding });
	}
}

if (findings.length === 0) {
	console.log(`check-no-shell-strings: all ${files.length} script(s) run commands without a shell`);
	process.exit(0);
}

console.log("check-no-shell-strings: shell-executing call(s) found:");
for (const { file, line, reason } of findings) {
	console.log(`  ${file}:${line}: ${reason}`);
}
console.log(`\ncheck-no-shell-strings: ${findings.length} error(s) — use scripts/lib/run-exec.mjs`);
process.exit(1);
