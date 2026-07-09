#!/usr/bin/env node
/**
 * check-spec-ids.mjs
 *
 * Scans docs/**\/*.md for `(SPEC_<id>)` id definitions and `[[SPEC_<id>]]`
 * strict references (#328, ADR-0027). Fails (exit 1) when:
 *   - the same id is defined more than once anywhere in the scanned files, or
 *   - a strict reference has no matching definition anywhere.
 *
 * Permissive references `[[SPEC_<id>?]]` are checked separately by
 * check-forward-ref-markers.mjs and are not dangling errors here.
 *
 * Usage:
 *   node scripts/check-spec-ids.mjs [files...]
 *   (no args → all git-tracked docs/**\/*.md files)
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
	findSpecIdDefinitions,
	findStrictRefs,
	findDuplicateDefinitions,
	findDanglingStrictRefs,
	formatSpecIdViolations,
} from "./lib/spec-id-check.mjs";

const args = process.argv.slice(2);
const files =
	args.length > 0
		? args
		: execSync('git ls-files "docs/**/*.md"', { encoding: "utf8" })
				.trim()
				.split("\n")
				.filter(Boolean);

const definitionHits = [];
const strictRefHits = [];
for (const file of files) {
	const text = readFileSync(file, "utf8");
	for (const hit of findSpecIdDefinitions(text)) {
		definitionHits.push({ file, ...hit });
	}
	for (const hit of findStrictRefs(text)) {
		strictRefHits.push({ file, ...hit });
	}
}

const duplicates = findDuplicateDefinitions(definitionHits);
const dangling = findDanglingStrictRefs(strictRefHits, definitionHits);

if (duplicates.length > 0 || dangling.length > 0) {
	console.error(
		`check-spec-ids: ${duplicates.length} duplicate definition(s), ${dangling.length} dangling strict reference(s):\n`,
	);
	console.error(formatSpecIdViolations(duplicates, dangling));
	process.exit(1);
} else {
	console.log("check-spec-ids: no violations found");
}
