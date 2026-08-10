#!/usr/bin/env node
// Review record check for CI (#698, #789).
//
// The authoritative half of a two-layer net. The terminal gate runs the same
// step locally, where a missing trailer is still fixable without rewriting
// pushed history; this one catches the PR that never ran the gate. Both call
// reviewRecordStep, so there is one place where the verdict is decided.
//
// Usage: node scripts/check-review-record.mjs [--base main]

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
	changedFilesSince,
	commitMessagesSince,
	reviewRecordStep,
} from "./lib/gate-check-steps.mjs";
import { tryRun } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// strict parsing, not an indexOf sweep: a hand-rolled lookup drops the
// --base=foo form and any typo'd flag, and this check's response to the wrong
// base is a verdict about the wrong range of commits (#648).
let values;
try {
	({ values } = parseArgs({
		args: process.argv.slice(2),
		options: { base: { type: "string" } },
		strict: true,
		allowPositionals: false,
	}));
} catch (err) {
	console.error(`check-review-record: ${err.message}`);
	process.exit(2);
}
const base = values.base ?? "main";

const exec = (file, execArgs) => tryRun(file, execArgs, { cwd: root });

const diff = changedFilesSince({ exec, base });
if (!diff.ok) {
	console.error(
		`check-review-record: failed to diff against origin/${base}: ${diff.error}`,
	);
	process.exit(1);
}

const result = reviewRecordStep({
	commitMessages: commitMessagesSince({ exec, base }),
	changedFiles: diff.files,
});
console.log(
	`check-review-record: ${result.status}${result.detail ? ` — ${result.detail}` : ""}`,
);

if (result.status === "FAIL") {
	console.error(
		"\nThe trailer is part of a commit message, so it cannot be appended later.",
	);
	console.error(
		"Run the review, then record the pass in the message of the commit you make next:",
	);
	console.error("  Review: tool=simplify");
	process.exit(1);
}
