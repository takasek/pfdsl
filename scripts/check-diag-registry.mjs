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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	diffDiagRegistry,
	evaluateDiagRegistryDiff,
	parseSpecDiagTable,
} from "./lib/diag-registry-check.mjs";
import { emitLinesAndExit } from "./lib/emit-lines.mjs";

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

emitLinesAndExit(
	evaluateDiagRegistryDiff({
		missingInSpec,
		staleInSpec,
		severityMismatches,
		specCodesCount: Object.keys(specCodes).length,
	}),
);
