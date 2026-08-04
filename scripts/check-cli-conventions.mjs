#!/usr/bin/env node
/**
 * check-cli-conventions.mjs
 *
 * Fails when a script reads its own argv, or decides whether it is the
 * entrypoint, in one of the two ways this repo retired (#648, #707). Both
 * shapes fail silently — a flag lookup that skips the flag it was handed, and
 * an entrypoint check that goes false across a symlink — so nothing in a test
 * run says they came back.
 *
 * Use node:util's parseArgs (strict: true) for flags, and isCliEntrypoint from
 * scripts/lib/cli-entrypoint.mjs for the entrypoint check.
 *
 * Usage: node scripts/check-cli-conventions.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findCliConventionViolations, selectScannedFiles } from "./lib/check-cli-conventions.mjs";
import { git } from "./lib/run-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const files = selectScannedFiles(git(["ls-files", "*.mjs"], { cwd: root }).trim().split("\n").filter(Boolean));

const findings = [];
for (const file of files) {
	for (const finding of findCliConventionViolations(readFileSync(resolve(root, file), "utf-8"), file)) {
		findings.push({ file, ...finding });
	}
}

if (findings.length === 0) {
	console.log(`check-cli-conventions: all ${files.length} script(s) parse argv strictly`);
	process.exit(0);
}

console.log("check-cli-conventions: retired argv shape(s) found:");
for (const { file, line, reason } of findings) {
	console.log(`  ${file}:${line}: ${reason}`);
}
console.log(`\ncheck-cli-conventions: ${findings.length} error(s)`);
process.exit(1);
