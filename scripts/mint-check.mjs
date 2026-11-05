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
import { runMintCheck } from "./lib/mint-check-steps.mjs";

const [slugArg, ...fileArgs] = process.argv.slice(2);

const result = runMintCheck({
	slugArg,
	fileArgs,
	readFile: (file) => readFileSync(file, "utf8"),
});
if (result.stdout) console.log(result.stdout);
console.error(result.stderr);
process.exit(result.exitCode);
