#!/usr/bin/env node
// Fails when a distributed prompt carries content only this repository can
// resolve. See scripts/lib/distributed-prose.mjs for the rules and for the
// subset deliberately left to human review.
//
// Run: node scripts/check-distributed-prose.mjs
//
// Scans the canonical sources rather than the generated plugin/ copies so the
// reported location is the file to edit. gen-plugin identity keeps the two in
// step, so checking one checks both.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findRepoSpecificProse } from "./lib/distributed-prose.mjs";
import { PLUGIN_AGENT_FILES, PLUGIN_COMMAND_FILES, PLUGIN_SKILL_DIRS } from "./lib/gen-plugin.mjs";
import { git } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Derived from what gen-plugin actually mirrors into the bundle, not from a
// filename convention: a hand-written glob silently drops any future member
// that is not named pfd-*, and the check would stay green while an unscanned
// file shipped. The pfdsl skill is excluded — its references are generated
// snapshots of docs/ carrying sample .pfdsl content, governed at their source.
// install/ is excluded too: those are scripts deployed into the adopting repo,
// not prompts, and their comments are read by maintainers of this repo.
const PATTERNS = [
	...PLUGIN_SKILL_DIRS.flatMap((d) => [`.claude/skills/${d}/*.md`, `.claude/skills/${d}/**/*.md`]),
	...PLUGIN_AGENT_FILES.map((f) => `.claude/agents/${f}`),
	...PLUGIN_COMMAND_FILES.map((f) => `.claude/commands/${f}`),
];

const paths = [
	...new Set(
		git(["ls-files", "--", ...PATTERNS], { cwd: root })
			.split("\n")
			.filter((p) => p && !p.includes("/install/")),
	),
].sort();
const files = paths.map((path) => ({ path, content: readFileSync(resolve(root, path), "utf-8") }));
const found = findRepoSpecificProse(files);

if (found.length > 0) {
	console.error("check-distributed-prose: content an adopting repo cannot resolve:");
	for (const f of found) console.error(`  ${f.path}:${f.line}: ${f.reason}\n    ${f.text}`);
	console.error("\nThese ship to repositories that are not this one. State the rule without the");
	console.error("local detail, or give the detail in a form the reader can resolve.");
	process.exit(1);
}

console.log(`check-distributed-prose: OK (${files.length} file(s))`);
