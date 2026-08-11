#!/usr/bin/env node

// PostToolUse(Bash) hook: appends one tab-separated line per Bash call to
// /tmp/pfdsl-cwd-drift.log, recording the hook payload's `cwd` alongside
// this hook process's own `process.cwd()` and whether they matched. See
// scripts/lib/cwd-drift-log.mjs for the line format.
//
// STOP CONDITION: this is not a permanent mechanism. verification-tree-guard.mjs
// (#840) trusts `payload.cwd` as the shell's actual cwd; this hook exists only
// to measure, empirically, whether that trust ever breaks — i.e. whether
// `payload.cwd` can read as the worktree while the shell that runs the next
// command is actually back in the main checkout, or vice versa. Once that
// question is answered, delete this file, scripts/lib/cwd-drift-log.mjs, its
// test, and the PostToolUse wiring in .claude/settings.json. The log's only
// consumer is a human reading it directly — no other script or hook reads it.
//
// Never prints to stdout — this hook is measurement only, not advisory, and
// PostToolUse's `additionalContext` is for the model, not a log sink. Always
// exits 0; a write failure (permissions, disk) must not wedge every Bash
// call.
//
// Usage (wired in .claude/settings.json): node scripts/cwd-drift-log.mjs

import { appendFile } from "node:fs/promises";
import { buildDriftLogLine } from "./lib/cwd-drift-log.mjs";
import { readStdinText } from "./lib/hook-io.mjs";

const LOG_PATH = "/tmp/pfdsl-cwd-drift.log";

const line = buildDriftLogLine(await readStdinText(), {
	processCwd: process.cwd(),
	now: () => new Date().toISOString(),
});

try {
	await appendFile(LOG_PATH, `${line}\n`);
} catch {
	// Swallow — measurement must never block a Bash call.
}
process.exit(0);
