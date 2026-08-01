#!/usr/bin/env node
/**
 * check-distribution-review.mjs
 *
 * Blocks a release while the distributed prompts have moved past the commit a
 * distribution review last approved. Wired into scripts/release.mjs's pre-tag
 * checks; scripts/release-status.mjs reports the same state without blocking.
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

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runDistributionReviewCheck } from "./lib/distribution-review.mjs";
import { git, tryGit } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_PATH = "docs/distribution-review/reviewed.json";

const result = runDistributionReviewCheck({
	readRecord: () => {
		const abs = resolve(root, RECORD_PATH);
		return existsSync(abs) ? JSON.parse(readFileSync(abs, "utf-8")) : null;
	},
	// A probe that is expected to fail when the record points somewhere this
	// clone cannot see, so its stderr is captured rather than printed as if
	// something broke — the message below says it better.
	commitExists: (sha) => tryGit(["cat-file", "-e", `${sha}^{commit}`], { cwd: root, captureStderr: true }).ok,
	// HEAD, not the working tree: the record names a commit, so the comparison
	// that decides whether it still holds has to be against one too. A release
	// refuses to run on a dirty tree anyway (release.mjs step 3).
	changedSince: (base) =>
		git(["diff", "--name-only", base, "HEAD", "--", "plugin/pfdsl"], { cwd: root })
			.trim()
			.split("\n")
			.filter(Boolean),
});

console[result.ok ? "log" : "error"](result.message);
process.exit(result.ok ? 0 : 1);
