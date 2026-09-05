#!/usr/bin/env node
// Design record draft check for issue #1114.
//
// The terminal gate uses the same classifier for the posted record, so a draft
// can be checked before it is published without introducing a second verdict.
//
// Usage: node scripts/check-design-record.mjs --file <path>

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { classifyDesignRecordRequiredFormat } from "./lib/gate-check.mjs";

let values;
try {
	({ values } = parseArgs({
		args: process.argv.slice(2),
		options: { file: { type: "string" } },
		strict: true,
		allowPositionals: false,
	}));
	if (!values.file) throw new Error("missing required argument: --file");
} catch (err) {
	console.error(`check-design-record: ${err.message}`);
	process.exit(2);
}

let body;
try {
	body = readFileSync(values.file, "utf8");
} catch (err) {
	console.error(`check-design-record: ${err.message}`);
	process.exit(2);
}
const result = classifyDesignRecordRequiredFormat(
	body,
	new Date().toISOString(),
);
console.log(
	`check-design-record: ${result.status}${result.detail ? ` — ${result.detail}` : ""}`,
);

if (result.status === "FAIL") process.exit(1);
