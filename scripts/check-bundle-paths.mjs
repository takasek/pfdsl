#!/usr/bin/env node
// Fails when a distributed skill/agent/command names a bundle-internal path
// only in its repo-local (.claude/) form. See scripts/lib/bundle-paths.mjs for
// why this is the checkable subset of the wider "upstream-only prose" class.
//
// Run: node scripts/check-bundle-paths.mjs
//
// Scans the canonical sources rather than the generated plugin/ copies so the
// reported location is the file to edit. gen-plugin identity keeps the two in
// step, so checking one checks both.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findUnqualifiedBundlePaths } from "./lib/bundle-paths.mjs";
import { PLUGIN_AGENT_FILES, PLUGIN_COMMAND_FILES, PLUGIN_SKILL_DIRS } from "./lib/gen-plugin.mjs";
import { git } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Derived from what gen-plugin actually mirrors into the bundle, not from a
// filename convention: a hand-written glob silently drops any future member
// that is not named pfd-*, and the check would stay green while an unscanned
// file shipped. The pfdsl skill is excluded — its references are generated
// snapshots of docs/ carrying sample .pfdsl content, governed at their source.
const PATTERNS = [
	...PLUGIN_SKILL_DIRS.flatMap((d) => [`.claude/skills/${d}/*.md`, `.claude/skills/${d}/**/*.md`]),
	...PLUGIN_AGENT_FILES.map((f) => `.claude/agents/${f}`),
	...PLUGIN_COMMAND_FILES.map((f) => `.claude/commands/${f}`),
];

const paths = [...new Set(git(["ls-files", "--", ...PATTERNS], { cwd: root }).split("\n").filter(Boolean))].sort();
const files = paths.map((path) => ({ path, content: readFileSync(resolve(root, path), "utf-8") }));
const found = findUnqualifiedBundlePaths(files);

if (found.length > 0) {
	console.error("check-bundle-paths: bundle path written only in its repo-local form:");
	for (const f of found) console.error(`  ${f.path}:${f.line}: ${f.text}`);
	console.error(
		"\nAn adopting repo loads these from the plugin cache, where .claude/ does not exist.",
	);
	console.error(
		"Give both forms on the line (`${CLAUDE_PLUGIN_ROOT}/...` and repo-local), label it 'repo-local:',",
	);
	console.error("or state the predicate instead of the path.");
	process.exit(1);
}

console.log(`check-bundle-paths: OK (${files.length} file(s))`);
