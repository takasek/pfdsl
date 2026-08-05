#!/usr/bin/env node
/**
 * check-forward-ref-markers.mjs
 *
 * Scans docs/**\/*.md for `[[SPEC_<slug>?]]` forward-ref markers and matches
 * them against `(SPEC_<slug>)` id definitions trailing a heading line. A
 * match suggests the forward-ref may now be resolved (the referenced feature
 * has landed) (#326).
 *
 * This cannot determine staleness automatically — only a human can judge
 * whether the referenced feature truly supersedes the forward-ref. It always
 * exits 0 and exists purely to surface likely-resolved markers as a
 * warning/reminder so the check isn't skipped during review.
 *
 * Usage:
 *   node scripts/check-forward-ref-markers.mjs [files...]
 *   (no args → all git-tracked docs/**\/*.md files)
 */

import { readFileSync } from "node:fs";
import { runForwardRefMarkerCheck } from "./lib/forward-ref-marker-check-steps.mjs";
import { git } from "./lib/run-exec.mjs";

const args = process.argv.slice(2);
const listFiles = () =>
	git(["ls-files", "docs/**/*.md"]).trim().split("\n").filter(Boolean);

const { lines } = runForwardRefMarkerCheck({
	args,
	listFiles,
	readFile: (file) => readFileSync(file, "utf8"),
});
for (const line of lines) console.log(line);
