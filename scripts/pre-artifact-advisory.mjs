#!/usr/bin/env node
// PostToolUse(Write|Edit) hook: on this cycle's first implementation write,
// puts the retro catalog's `phase: pre-artifact` patterns in front of the
// runner (#964). See scripts/lib/pre-artifact-advisory.mjs for why the
// existing two reference points cannot reach code, and why this is an advisory
// rather than a gate.
//
// Always exits 0 — this never blocks anything.
//
// Usage (wired in .claude/settings.json): node scripts/pre-artifact-advisory.mjs

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreArtifactReminders } from "./lib/cycle-status.mjs";
import { readStdinText } from "./lib/hook-io.mjs";
import { runPreArtifactAdvisory } from "./lib/pre-artifact-advisory.mjs";
import {
	loadPatternCatalogOrThrow,
	PATTERN_DIR_RELATIVE,
} from "./lib/retro-patterns.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The "already reminded" mark lives in the OS temp directory rather than the
// worktree: it is per-session state, not per-branch, and nothing in the repo
// should gain an untracked file because a hook fired. Temp survives longer
// than a session and nothing prunes these, but each is an empty file and the
// OS clears the directory on its own schedule — a cleanup path would be more
// machinery than the thing it collects.
//
// The id is hashed rather than sanitised into a filename. It arrives as
// untrusted payload text, and substituting the characters a filename cannot
// hold maps distinct ids onto one path (`a/b` and `a_b` both become `a_b`) —
// which here means one session silently inheriting another's mark and never
// seeing the advisory at all. Hashing also bounds the name.
const markerPath = (key) =>
	join(
		tmpdir(),
		`pfdsl-pre-artifact-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`,
	);

// The cycle's branch, standing in for the cycle itself (see advisoryKey).
// `git` is spawned rather than the branch read from the payload because the
// payload carries no such field; a detached HEAD or a failure here returns
// null and the scope widens to the session.
const currentBranch = () => {
	const { status, stdout } = spawnSync(
		"git",
		["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"],
		{ encoding: "utf8" },
	);
	return status === 0 ? stdout.trim() || null : null;
};

const { shouldOutput, output } = runPreArtifactAdvisory(await readStdinText(), {
	root,
	cycleId: currentBranch,
	loadReminders: () =>
		buildPreArtifactReminders(
			loadPatternCatalogOrThrow(resolve(root, PATTERN_DIR_RELATIVE), {
				readdirSync,
				readFileSync,
				displayPath: (path) => relative(root, path),
			}),
		),
	hasFired: (key) => existsSync(markerPath(key)),
	markFired: (key) => writeFileSync(markerPath(key), ""),
});
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
