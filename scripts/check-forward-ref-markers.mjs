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
import { execSync } from "node:child_process";
import {
	findForwardRefMarkers,
	findImplementsMarkers,
	matchResolvedForwardRefs,
	formatResolvedForwardRefs,
} from "./lib/forward-ref-marker-check.mjs";

const args = process.argv.slice(2);
const files =
	args.length > 0
		? args
		: execSync('git ls-files "docs/**/*.md"', { encoding: "utf8" })
				.trim()
				.split("\n")
				.filter(Boolean);

const forwardRefHits = [];
const implementsHits = [];
for (const file of files) {
	const text = readFileSync(file, "utf8");
	for (const hit of findForwardRefMarkers(text)) {
		forwardRefHits.push({ file, ...hit });
	}
	for (const hit of findImplementsMarkers(text)) {
		implementsHits.push({ file, ...hit });
	}
}

const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);

if (resolved.length > 0) {
	console.log(
		`check-forward-ref-markers: ${resolved.length} forward-ref marker(s) likely resolved — confirm and update the referenced text:\n`,
	);
	console.log(formatResolvedForwardRefs(resolved));
} else {
	console.log(
		"check-forward-ref-markers: no resolved forward-ref markers found",
	);
}
