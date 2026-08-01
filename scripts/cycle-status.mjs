#!/usr/bin/env node
// Cycle preflight: bundles step-1 mechanical operations (fetch, rebase-behind
// check, flow-sync PR check, ready listing) into one compact JSON payload.
// Usage: node scripts/cycle-status.mjs [--base main]

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./lib/run-exec.mjs";
import { runCycleStatus } from "./lib/cycle-status-steps.mjs";
import { execGh } from "./pfdsl/lib/gh-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const args = process.argv.slice(2);
const baseFlagIdx = args.indexOf("--base");
const base = baseFlagIdx >= 0 ? args[baseFlagIdx + 1] : "main";

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
});

console.log(JSON.stringify(result, null, 2));
