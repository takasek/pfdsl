#!/usr/bin/env node
/**
 * check-distributed-prose.mjs
 *
 * Fails when a distributed prompt carries content only this repository can
 * resolve. See scripts/lib/distributed-prose.mjs for the rules, and for the
 * subset deliberately left to human review.
 *
 * This is the decidable floor under the distribution review: what a regexp can
 * settle should not cost a review round, and what it cannot settle — prose
 * whose *subject* is this repo's workbench — is what the review is for. Run
 * every CI via `make check-docs`, so the count only ever ratchets down.
 *
 * Scans the assembled bundle and reports the canonical source of each hit, so
 * the scope matches the review's exactly (scripts/lib/distribution-review.mjs)
 * while the reported location stays the file to edit.
 *
 * Run: node scripts/check-distributed-prose.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSourceOf, inScope } from "./lib/distribution-review.mjs";
import { findRepoSpecificProse } from "./lib/distributed-prose.mjs";
import { git } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const paths = git(["ls-files", "plugin/pfdsl/**/*.md"], { cwd: root })
	.split("\n")
	.filter(inScope)
	.sort();

const files = paths.map((path) => ({ path, content: readFileSync(resolve(root, path), "utf-8") }));
const found = findRepoSpecificProse(files);

if (found.length > 0) {
	console.error("check-distributed-prose: content an adopting repo cannot resolve:");
	for (const f of found) console.error(`  ${canonicalSourceOf(f.path)}:${f.line}: ${f.reason}\n    ${f.text}`);
	console.error("\nThese ship to repositories that are not this one. State the rule without the");
	console.error("local detail, or give the detail in a form the reader can resolve.");
	console.error("Line numbers are the bundle's; the path is the file to edit.");
	process.exit(1);
}

console.log(`check-distributed-prose: OK (${files.length} file(s))`);
