#!/usr/bin/env node
// Cycle preflight: bundles step-1 mechanical operations (fetch, rebase-behind
// check, open PR listing, ready listing) into one compact JSON payload.
// Usage: node scripts/cycle-status.mjs [--base main] [--issue <n> ...]

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	cycleStatusExitCode,
	runCycleStatus,
} from "./lib/cycle-status-steps.mjs";
import { parseIssueNumbers } from "./lib/issue-args.mjs";
import { run, tryRun } from "./lib/run-exec.mjs";
import { createGitHubOps } from "./pfdsl/lib/github-ops.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// strict parsing, not an indexOf sweep: --base=foo was skipped outright, so
// the preflight measured the lag against main while reporting the branch the
// caller had asked for nowhere at all (#648).
let values;
try {
	({ values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			base: { type: "string" },
			issue: { type: "string", multiple: true },
		},
		strict: true,
		allowPositionals: false,
	}));
} catch (err) {
	console.error(`cycle-status: ${err.message}`);
	process.exit(2);
}
const base = values.base ?? "main";
// Retain every explicit target in the source reads and terminal review command.
const parsedIssues = parseIssueNumbers(values.issue);
if (!parsedIssues.ok) {
	console.error(`cycle-status: ${parsedIssues.message}`);
	process.exit(2);
}
const issueNumbers = parsedIssues.numbers;

// `base` comes from argv; naming the executable and arguments separately keeps
// it out of a shell (#572).
const sh = (file, args) => run(file, args, { cwd: root });
// stderr is left inherited, not captured: release-status warns there about a
// distribution review it could not read at all, and that warning is the one
// reading its stdout cannot carry. Capturing it would drop it — `run` returns
// stdout alone — so it goes to the terminal while stdout becomes the report
// (#814).
const shTry = (file, args) => tryRun(file, args, { cwd: root });

const result = await runCycleStatus({
	sh,
	shTry,
	githubOps: createGitHubOps({ cwd: root }),
	existsSync,
	readFileSync,
	root,
	base,
	issueNumbers,
});

console.log(JSON.stringify(result, null, 2));

// Non-zero so a caller that only reads the exit status still stops: the payload
// carries no judgments in either case, and such a preflight is exactly the
// output a reader mistakes for "checked, nothing wrong" (#716, #744).
const exitCode = cycleStatusExitCode(result);
if (exitCode !== 0) process.exit(exitCode);
