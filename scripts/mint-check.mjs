#!/usr/bin/env node
/**
 * mint-check.mjs
 *
 * Before minting a new spec ID slug, list every prior occurrence of that slug
 * across the spec ID cross-reference constructs (ADR-0027, #405): definitions
 * `(SPEC_<slug>)`, strict references `[[SPEC_<slug>]]`, and forward-ref markers
 * `[[SPEC_<slug>?]]`. Guards against silently reusing a slug an existing
 * forward-ref already claims (which check-spec-ids cannot catch).
 *
 * tombstone occurrences are out of scope until the first ID deletion defines
 * the tombstone list's form (#405 defers it; ADR-0027 §"ID の性質").
 *
 * Usage:
 *   node scripts/mint-check.mjs <slug> [files...]
 *   (slug may be given bare or SPEC_-prefixed; no files → docs/spec/spec.md)
 *
 * Exit codes:
 *   0 — no prior occurrence; safe to mint the slug.
 *   1 — at least one prior occurrence (listed on stdout); do not mint blindly.
 */

import { readFileSync } from "node:fs";
import {
	normalizeId,
	findOccurrencesInText,
	formatOccurrences,
	mintCheckExitCode,
} from "./lib/mint-check.mjs";

const [slugArg, ...fileArgs] = process.argv.slice(2);

if (!slugArg) {
	console.error("usage: node scripts/mint-check.mjs <slug> [files...]");
	process.exit(2);
}

const id = normalizeId(slugArg);
const files = fileArgs.length > 0 ? fileArgs : ["docs/spec/spec.md"];

const occurrences = [];
for (const file of files) {
	const text = readFileSync(file, "utf8");
	occurrences.push(...findOccurrencesInText(id, file, text));
}

const exitCode = mintCheckExitCode(occurrences);
if (exitCode === 0) {
	console.error(`mint-check: "${id}" has no prior occurrence — safe to mint.`);
} else {
	console.log(formatOccurrences(occurrences));
	console.error(
		`mint-check: "${id}" already occurs ${occurrences.length} time(s) — resolve before minting.`,
	);
}
process.exit(exitCode);
