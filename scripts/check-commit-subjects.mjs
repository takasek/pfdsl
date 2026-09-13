#!/usr/bin/env node

/**
 * check-commit-subjects.mjs
 *
 * The commit-subject lint as a standalone verdict, for CI.
 *
 * gate-check.mjs runs the same check, but only when a cycle's runner invokes
 * it, and only over the range that existed at that moment. Commits pushed
 * afterwards are never judged: the gate's green stays green and nothing
 * re-derives it (#1174). A `pull_request` workflow calling this script fires
 * on every push to the branch, so the verdict is recomputed over the current
 * range each time.
 *
 * Both callers go through checkCommitSubjects so the range and the merge
 * exclusion have one owner. Sharing only the subject linter would let this
 * script build its own range and disagree with the gate about the same
 * commits.
 *
 * `--base` is a ref, not a branch name: CI passes `origin/<base_ref>` after a
 * full-history checkout, which is the same range definition the gate uses.
 * `--head` defaults to HEAD; CI passes the event payload's head SHA, because a
 * `pull_request` checkout leaves HEAD on a synthetic merge commit unless the
 * workflow points it elsewhere.
 *
 * Usage: node scripts/check-commit-subjects.mjs --base <ref> [--head <ref>]
 */

import { parseArgs } from "node:util";
import { checkCommitSubjects } from "./lib/gate-check.mjs";
import { tryRun } from "./lib/run-exec.mjs";

// strict parsing for the same reason gate-check.mjs uses it: a typo'd flag
// must stop the run rather than silently fall back to a default range, which
// would report a verdict about commits nobody asked about.
let values;
try {
	({ values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			base: { type: "string" },
			head: { type: "string", default: "HEAD" },
		},
		strict: true,
		allowPositionals: false,
	}));
} catch (err) {
	console.error(`check-commit-subjects: ${err.message}`);
	process.exit(2);
}

if (!values.base) {
	console.error("check-commit-subjects: missing --base <ref>");
	console.error(
		"Usage: node scripts/check-commit-subjects.mjs --base <ref> [--head <ref>]",
	);
	process.exit(2);
}

const result = checkCommitSubjects({
	exec: tryRun,
	baseRef: values.base,
	headRef: values.head,
});

const detail = result.detail ? ` — ${result.detail}` : "";
console.log(`check-commit-subjects: ${result.status}${detail}`);
if (result.status === "FAIL") {
	// What the predicate enforces, not what the convention aspires to: it
	// rejects CJK outside quoted spans and says nothing about other scripts, so
	// naming "English" here would promise a check that does not exist.
	console.error(
		"Commit subjects must follow Conventional Commits and carry no CJK text outside quoted spans.",
	);
	process.exit(1);
}
