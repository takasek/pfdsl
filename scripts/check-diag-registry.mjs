#!/usr/bin/env node
/**
 * check-diag-registry.mjs
 *
 * Diffs the `docs/spec/spec.md` §16 diagnostic code table against the
 * DIAGNOSTIC_REGISTRY exported by @pfdsl/core (packages/core/dist, must be
 * built first — see `make build-deps`). Catches the spec/implementation
 * drift described in #299: a code emitted by the checker but undocumented
 * in §16, a stale code documented but no longer emitted, or a severity
 * that disagrees between the two.
 *
 * Usage:
 *   node scripts/check-diag-registry.mjs
 *
 * Exit 0 = spec and registry agree, Exit 1 = drift found.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpecDiagTable, diffDiagRegistry } from "./lib/diag-registry-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const { DIAGNOSTIC_REGISTRY } = await import(
	resolve(root, "packages/core/dist/index.js")
);

const specText = readFileSync(resolve(root, "docs/spec/spec.md"), "utf8");
const specCodes = parseSpecDiagTable(specText);
const { missingInSpec, staleInSpec, severityMismatches } = diffDiagRegistry(
	specCodes,
	DIAGNOSTIC_REGISTRY,
);

let failed = false;

if (missingInSpec.length > 0) {
	failed = true;
	console.error(
		`Codes emitted by core but missing from spec.md §16 table: ${missingInSpec.join(", ")}`,
	);
}
if (staleInSpec.length > 0) {
	failed = true;
	console.error(
		`Codes in spec.md §16 table but not emitted by core (stale): ${staleInSpec.join(", ")}`,
	);
}
if (severityMismatches.length > 0) {
	failed = true;
	console.error(
		`Severity mismatch between spec.md §16 table and core registry: ${severityMismatches.join(", ")}`,
	);
}

if (failed) {
	console.error(
		"\ncheck-diag-registry: FAILED. Update docs/spec/spec.md §16 and/or packages/core/src/diagnostics-registry.ts to match.",
	);
	process.exit(1);
}

console.log(
	`check-diag-registry: OK (${Object.keys(specCodes).length} codes match)`,
);
