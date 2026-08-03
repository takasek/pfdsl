#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: asks for `make release-status` before a new
// publish process is declared in roadmap.pfdsl (#650). See
// scripts/lib/roadmap-publish-guard.mjs for the detection logic, why this is
// ask rather than deny, and the stdin orchestration.
//
// Always exits 0 — a crash in this guard must not wedge every Edit/Write call.
//
// Usage (wired in .claude/settings.json): node scripts/roadmap-publish-guard.mjs

import { readFileSync } from "node:fs";

import { runRoadmapPublishGuard } from "./lib/roadmap-publish-guard.mjs";
import { readStdinText } from "./lib/hook-io.mjs";

/** The file as it stands, or undefined when it cannot be read (new file, no access). */
function readFile(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

const { shouldOutput, output } = runRoadmapPublishGuard(await readStdinText(), { readFile });
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
