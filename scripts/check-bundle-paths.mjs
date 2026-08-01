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
import { globSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The pfdsl skill is excluded: its references are generated snapshots of docs/
// and carry sample .pfdsl content, so they are governed at their own source.
const PATTERNS = [
	".claude/skills/pfd-*/**/*.md",
	".claude/skills/pfd-*/*.md",
	".claude/agents/pfd-*.md",
	".claude/commands/pfd-*.md",
];

const paths = [...new Set(PATTERNS.flatMap((p) => globSync(p, { cwd: root })))].sort();
const files = paths.map((path) => ({ path, content: readFileSync(resolve(root, path), "utf-8") }));

const { findUnqualifiedBundlePaths } = await import("./lib/bundle-paths.mjs");
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
