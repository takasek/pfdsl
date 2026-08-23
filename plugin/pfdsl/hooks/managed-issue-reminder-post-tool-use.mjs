#!/usr/bin/env node
// Distributed PostToolUse(Bash) executable for the managed-issue advisory.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runManagedIssueReminder } from "./lib/managed-issue-reminder.mjs";

export function isCliEntrypoint(metaUrl, argv1, { realpath = realpathSync } = {}) {
	if (!argv1) return false;
	let resolved = argv1;
	try {
		resolved = realpath(argv1);
	} catch {
		// An unresolved invocation path can still equal the module URL verbatim.
	}
	return metaUrl === pathToFileURL(resolved).href;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	let input = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) input += chunk;
	const { shouldOutput, output } = runManagedIssueReminder(input);
	if (shouldOutput) console.log(JSON.stringify(output));
	process.exit(0);
}
