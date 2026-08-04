#!/usr/bin/env node
/**
 * check-distribution-review.mjs
 *
 * Blocks a release while the distributed prompts have moved past the commit a
 * distribution review last approved. Wired into scripts/release.mjs's pre-tag
 * checks; scripts/release-status.mjs reports the same verdict without blocking,
 * through the same deps, so the two cannot disagree.
 *
 * Not wired into CI. Roughly a fifth of merges touch the distributed layer, and
 * a gate firing that often turns the review into a box to tick. Publication is
 * rare and is the only moment an adopter is actually handed the prose, so the
 * scarcity of the trigger is doing work here.
 *
 * Usage: node scripts/check-distribution-review.mjs
 *   exit 0 — the record covers what the bundle currently says
 *   exit 1 — it does not, or there is no record to go on
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	repoDeps,
	runDistributionReviewCheck,
} from "./lib/distribution-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = runDistributionReviewCheck(repoDeps(root));

console[result.ok ? "log" : "error"](result.message);
process.exit(result.ok ? 0 : 1);
