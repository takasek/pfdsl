#!/usr/bin/env node
/**
 * check-no-shell-strings.mjs
 *
 * Fails when a script builds a shell command line by interpolation. Those
 * scripts take refs, artifact keys, tags and paths from argv and from other
 * commands' output, and `execSync` hands the whole string to a shell — a space
 * word-splits and a semicolon starts another command (#571 found this in
 * review-measurement, #572 in gate-check and cycle-status).
 *
 * Use `scripts/lib/run-exec.mjs`, which names the executable and its arguments
 * separately. A constant command line stays allowed: nothing can be injected
 * into it.
 *
 * Usage: node scripts/check-no-shell-strings.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findShellStringInterpolations } from "./lib/check-no-shell-strings.mjs";
import { git } from "./lib/run-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Both patterns are needed: "scripts/**/*.mjs" misses scripts/*.mjs itself.
const files = git(["ls-files", "scripts/*.mjs", "scripts/**/*.mjs"], { cwd: root })
	.trim()
	.split("\n")
	.filter(Boolean)
	.filter((f, i, arr) => arr.indexOf(f) === i)
	// The detector's own fixtures are offending snippets as string data.
	.filter((f) => !f.endsWith(".test.mjs"));

const findings = [];
for (const file of files) {
	for (const finding of findShellStringInterpolations(readFileSync(resolve(root, file), "utf-8"))) {
		findings.push({ file, ...finding });
	}
}

if (findings.length === 0) {
	console.log(`check-no-shell-strings: all ${files.length} script(s) keep interpolation out of shell command lines`);
	process.exit(0);
}

console.log("check-no-shell-strings: interpolated shell command line(s) found:");
for (const { file, line, snippet } of findings) {
	console.log(`  ${file}:${line}: ${snippet.trim()}`);
}
console.log(`\ncheck-no-shell-strings: ${findings.length} error(s) — use scripts/lib/run-exec.mjs`);
process.exit(1);
