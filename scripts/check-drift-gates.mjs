#!/usr/bin/env node
/**
 * check-drift-gates.mjs
 *
 * The pre-commit gates other than biome. Reports every failing one in a single
 * pass, so clearing two of them costs one commit attempt rather than two
 * (takasek/pfdsl#755, #759).
 *
 * The gates live in scripts/lib/drift-gates.mjs rather than in
 * scripts/pre-commit because the sh version passed each check to `eval` as a
 * command line — the one place in this repo where check logic sat outside
 * scripts/lib and its tests. Commands are named as executable + argv
 * (scripts/check-no-shell-strings.mjs). Which gates exist, in which order, and
 * how the per-file ones are derived from the staged paths is documented there.
 *
 * CI runs these checks via different mechanisms (a dedicated workflow for
 * gen-skill, since it also needs its own checkout for cross-repo install-skill
 * consumption; an inline `make check-readme-cli` step in test.yml; a vitest
 * test for gen-samples, since dogfooding the exporter is itself the check).
 * Left as-is — no functional difference, and converging them isn't worth the
 * churn (see #265).
 *
 * The .claude/skills/pfdsl dev copy has no gate of its own because it is a symlink to generated/skills/pfdsl (#714), so the tracked-copy gates cover the same bytes.
 * Its trigger pattern (scripts/lib/gen-skill-trigger.mjs) is still used by gate-check.mjs.
 *
 * Usage: node scripts/check-drift-gates.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isDistStale } from "./lib/dist-freshness.mjs";
import { buildGates } from "./lib/drift-gates.mjs";
import { runDriftGates } from "./lib/pre-commit-drift.mjs";
import { gitDiffNames, tryRun } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string[]} args */
function stagedPaths(args) {
	return gitDiffNames(["--cached", ...args], { cwd: root });
}

const staged = stagedPaths([]);
// Deletions are staged changes, but not files a per-file check can be run on.
const stagedPresent = stagedPaths(["--diff-filter=d"]);

const { failures, notes } = runDriftGates(buildGates({ stagedPresent }), {
	stagedFiles: staged,
	// The gates name their dist files relative to the repository root, as their
	// hints and commands do; git already runs at `root` above. Resolving here
	// keeps that true of the freshness question too, which was the one thing
	// still asked against process.cwd() (#771).
	isDistFresh: (path) => !isDistStale(resolve(root, path)),
	runCommand: (file, args) =>
		tryRun(file, args, { cwd: root, captureStderr: true }).ok,
});

for (const note of notes) {
	console.log(note);
}
for (const failure of failures) {
	console.log(failure.hint);
}

if (failures.length > 0) {
	process.exit(1);
}
