#!/usr/bin/env node
/**
 * check-asset-sweep.mjs
 *
 * Blocks a release while any registered target in SWEEP_TARGETS
 * (scripts/lib/asset-sweep.mjs) has accumulated more in-scope additions than
 * its threshold since its last recorded sweep. Wired into scripts/release.mjs's
 * pre-tag checks; scripts/release-status.mjs reports the same verdict without
 * blocking, through the same deps, so the two cannot disagree.
 *
 * Not wired into CI or the pre-commit hook. Each target's threshold is
 * deliberately sized so this fires rarely — a handful of times a month, not
 * on every commit — because a gate that fires every commit is the gate
 * `docs/distribution-review/reviewed.json`'s own docstring warns about
 * turning a review into a box to tick. CI has no notion of "additions since
 * the last recorded sweep" the way a release does either: every commit's CI
 * run would either re-derive the same verdict release-status.mjs already
 * reports, or need its own record of what CI has already flagged.
 *
 * Usage: node scripts/check-asset-sweep.mjs
 *   exit 0 — every registered target's sweep record covers its current state
 *   exit 1 — at least one target is overdue for a sweep, or has no record yet
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { repoDeps, runAssetSweepCheck } from "./lib/asset-sweep.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = runAssetSweepCheck(repoDeps(root));

console[result.ok ? "log" : "error"](result.message);
process.exit(result.ok ? 0 : 1);
