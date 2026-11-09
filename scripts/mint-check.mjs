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
 *   (slug may be bare or SPEC_-prefixed; no files → all tracked docs/**\/*.md)
 *
 * Exit codes:
 *   0 — no prior occurrence; safe to mint the slug.
 *   1 — at least one prior occurrence (listed on stdout); do not mint blindly.
 *   2 — usage error, or no docs files to scan (never reported as safe).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMintCheck } from "./lib/mint-check-steps.mjs";
import { gitLsFiles } from "./lib/run-exec.mjs";

const [slugArg, ...fileArgs] = process.argv.slice(2);

// The default corpus is the repository's docs, wherever this is run from.
if (fileArgs.length === 0) {
	process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}

const result = runMintCheck({
	slugArg,
	fileArgs,
	listFiles: () => gitLsFiles(["docs/**/*.md"]),
	readFile: (file) => readFileSync(file, "utf8"),
});
if (result.stdout) console.log(result.stdout);
console.error(result.stderr);
process.exit(result.exitCode);
