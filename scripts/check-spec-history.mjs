#!/usr/bin/env node
/**
 * check-spec-history.mjs
 *
 * Blocks a release when docs/spec/spec.md's title-line version has no
 * matching entry in docs/spec/spec-history.md. Wired into scripts/release.mjs's
 * pre-tag checks; scripts/release-status.mjs reports the same verdict without
 * blocking, through the same deps, so the two cannot disagree.
 *
 * Not wired into CI or scripts/pre-commit — a version bump made mid-development
 * doesn't need its changelog entry written until the release that ships it.
 *
 * Usage: node scripts/check-spec-history.mjs
 *   exit 0 — spec-history.md documents the current spec.md version
 *   exit 1 — it does not, or spec.md has no title-line version to check
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { repoDeps, runSpecHistoryCheck } from "./lib/spec-history-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = runSpecHistoryCheck(repoDeps(root));

console[result.ok ? "log" : "error"](result.message);
process.exit(result.ok ? 0 : 1);
