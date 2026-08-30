#!/usr/bin/env node
// Closes-keyword check for CI (#801).
//
// This is the final word, but not the only layer anymore: scripts/lib/
// closes-create-guard.mjs (#871) asks before a `gh pr create` bound for the
// default branch is even run, from a token found in the command line. That
// evidence is weaker than what this check uses — the close link GitHub
// derives from the merged PR body, not a string match — so it can be talked
// past (approved once) or miss cases this check still catches (`--web`, an
// unreadable `--body-file`). This check is what actually gates the merge;
// the guard only narrows how often it has to.
//
// Usage: node scripts/check-closes-reference.mjs --pr <n> --base <ref> --default-branch <ref>

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { classifyClosesReference } from "./lib/closes-reference.mjs";
import { isGhUnavailableError } from "./pfdsl/lib/gh-compat.mjs";
import { createGitHubOps } from "./pfdsl/lib/github-ops.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const githubOps = createGitHubOps({ cwd: root });

let values;
try {
	({ values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			pr: { type: "string" },
			base: { type: "string" },
			"default-branch": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	}));
} catch (err) {
	console.error(`check-closes-reference: ${err.message}`);
	process.exit(2);
}

// Every one of these comes from the workflow's event payload. Defaulting any
// of them would decide the verdict from a guess: a missing --base reads as an
// intermediate PR and skips, which is the answer that never fails.
for (const flag of ["pr", "base", "default-branch"]) {
	if (!values[flag]) {
		console.error(`check-closes-reference: --${flag} is required`);
		process.exit(2);
	}
}

let pr;
try {
	pr = await githubOps.viewPr({
		number: Number(values.pr),
		fields: ["body", "closingIssuesReferences"],
	});
} catch (err) {
	// The same split every gh-backed lookup here draws (#745): only a missing
	// binary is the environment's doing and degrades to SKIP. A lookup that ran
	// and failed has to fail the job, or the row is one nobody acts on.
	if (isGhUnavailableError(err)) {
		console.log("check-closes-reference: SKIP — gh CLI unavailable");
		process.exit(0);
	}
	console.error(
		`check-closes-reference: FAIL — PR lookup failed: ${err.message}`,
	);
	process.exit(1);
}

const result = classifyClosesReference({
	baseRef: values.base,
	defaultBranch: values["default-branch"],
	closingIssueCount: pr.closingIssuesReferences?.length ?? 0,
	body: pr.body ?? "",
});
console.log(`check-closes-reference: ${result.status} — ${result.detail}`);

if (result.status === "FAIL") {
	console.error(
		"\nWithout the link the merge leaves the issue open and never triggers",
	);
	console.error("the flow-sync workflow. Edit the PR body to include:");
	console.error("  Closes #<issue number>");
	console.error("\nIf this PR has no issue to close, declare why instead:");
	console.error("  no-issue: <reason>");
	process.exit(1);
}
