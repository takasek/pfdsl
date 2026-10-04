#!/usr/bin/env node
// Roadmap-registration check for CI (#963).
//
// Runs on a PR that edits .pfdsl/roadmap.pfdsl, before merge. The audit treats
// a `flow:managed` issue with no tracked process as advisory, because in any
// given tree that gap usually belongs to another session's unmerged branch.
// This check enforces it for the issues GitHub reads this PR as closing — the
// local set the PR can actually register, derived from the PR itself rather than
// from a flag the runner chooses.
//
// Usage: node scripts/check-roadmap-registration.mjs --pr <n>

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
	buildAuditArgs,
	classifyRoadmapRegistration,
	localClosingIssueNumbers,
} from "./lib/roadmap-registration.mjs";
import { tryRun } from "./lib/run-exec.mjs";
import {
	createGitHubOps,
	isGitHubUnavailableError,
} from "./pfdsl/lib/github-ops.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const githubOps = createGitHubOps({ cwd: root });

let values;
try {
	({ values } = parseArgs({
		args: process.argv.slice(2),
		options: { pr: { type: "string" } },
		strict: true,
		allowPositionals: false,
	}));
} catch (err) {
	console.error(`check-roadmap-registration: ${err.message}`);
	process.exit(2);
}

if (!values.pr) {
	console.error("check-roadmap-registration: --pr is required");
	process.exit(2);
}

let issueNumbers;
try {
	const pr = await githubOps.viewPr({
		number: Number(values.pr),
		fields: ["closingIssuesReferences"],
	});
	issueNumbers = localClosingIssueNumbers(
		pr.closingIssuesReferences,
		githubOps.repository(),
	);
} catch (err) {
	// Same operation API contract as check-closes-reference (#1085).
	if (isGitHubUnavailableError(err)) {
		console.log(`check-roadmap-registration: SKIP — ${err.message}`);
		process.exit(0);
	}
	console.error(
		`check-roadmap-registration: FAIL — PR lookup failed: ${err.message}`,
	);
	process.exit(1);
}

let auditExit = 0;
if (issueNumbers.length > 0) {
	const result = tryRun(process.execPath, buildAuditArgs(issueNumbers), {
		cwd: root,
	});
	// execFileSync pipes the child's stdout rather than inheriting it, so the
	// audit's per-issue findings are in `out` and reach the CI log only if this
	// prints them. Without this the job shows the verdict and none of the
	// evidence for it.
	if (result.out) process.stdout.write(result.out);
	auditExit = result.ok ? 0 : (result.status ?? 1);
}

const verdict = classifyRoadmapRegistration({ issueNumbers, auditExit });
console.log(
	`check-roadmap-registration: ${verdict.status} — ${verdict.detail}`,
);

if (verdict.status === "FAIL") {
	console.error("\nSee the audit findings above for details.");
	process.exit(1);
}
