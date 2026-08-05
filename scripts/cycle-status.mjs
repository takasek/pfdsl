#!/usr/bin/env node
// Cycle preflight: bundles step-1 mechanical operations (fetch, rebase-behind
// check, flow-sync PR check, ready listing) into one compact JSON payload.
// Usage: node scripts/cycle-status.mjs [--base main] [--issue <n>]

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runCycleStatus } from "./lib/cycle-status-steps.mjs";
import { run } from "./lib/run-exec.mjs";
import { execGh } from "./pfdsl/lib/gh-exec.mjs";

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
			issue: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	}));
} catch (err) {
	console.error(`cycle-status: ${err.message}`);
	process.exit(2);
}
const base = values.base ?? "main";
const issueNumber = values.issue !== undefined ? Number(values.issue) : null;

// `base` comes from argv; naming the executable and arguments separately keeps
// it out of a shell (#572).
const sh = (file, args) => run(file, args, { cwd: root });

const result = await runCycleStatus({
	sh,
	execGh: (execArgs) => execGh(execArgs, { cwd: root }),
	existsSync,
	readFileSync,
	root,
	base,
	issueNumber,
});

console.log(JSON.stringify(result, null, 2));

// Non-zero so a caller that only reads the exit status still stops: the payload
// carries no judgments in this case, and an old tree's preflight is exactly the
// output a reader mistakes for "checked, nothing wrong" (#716).
if (result.staleTree) process.exit(1);
