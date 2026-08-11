#!/usr/bin/env node
/**
 * check-review-perspectives-scale.mjs
 *
 * Reports the byte size and item count of the two review-perspectives.md
 * catalogs — the distributed catalog (docs/review-perspectives.md) and this
 * repo's instance of it (.pfdsl/review-perspectives.md) — so a growth into
 * split-worthy territory (20KB or 40 items, #797) surfaces without anyone
 * having to measure it by hand.
 *
 * This is a notice, not a gate: exit code is always 0. Whether to split is a
 * judgment call this script does not make.
 *
 * Usage: node scripts/check-review-perspectives-scale.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitLinesAndExit } from "./lib/emit-lines.mjs";
import {
	evaluateCatalogScale,
	measureCatalogScale,
} from "./lib/review-perspectives-scale.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const paths = ["docs/review-perspectives.md", ".pfdsl/review-perspectives.md"];

const measurements = paths.map((path) =>
	measureCatalogScale({
		path,
		content: readFileSync(resolve(root, path), "utf8"),
	}),
);

emitLinesAndExit(evaluateCatalogScale(measurements));
