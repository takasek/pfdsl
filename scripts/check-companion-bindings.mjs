#!/usr/bin/env node
/**
 * check-companion-bindings.mjs
 *
 * pfd-retro's audit and pfd-ops's L2 dispatch resolve through multi-step
 * pointer chains (companion .md prose -> a repo-relative path -> a required
 * section heading), and nothing checked those pointers stayed valid as files
 * got renamed or sections got reworded (#344).
 *
 * 1. Scans .pfdsl markdown companions for repo-relative path references
 *    (inline code and markdown links starting with docs/, .claude/,
 *    scripts/, packages/) and verifies each resolves to an existing
 *    file/directory. Assumes the repo is built (e.g. packages/cli/dist
 *    exists) — this runs as part of `make check-docs`, which already
 *    assumes that for other checks.
 * 2. If .pfdsl/bindings/pfd-retro.md exists, verifies it has the "pfd-retro
 *    バインディング" and "retro 実行記録" headings pfd-retro's audit
 *    protocol depends on being able to find.
 *
 * Usage: node scripts/check-companion-bindings.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	extractPathReferences,
	resolveCheckTarget,
	findMissingHeadings,
} from "./lib/companion-binding-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const REQUIRED_PFD_RETRO_BINDING_HEADINGS = ["pfd-retro バインディング", "retro 実行記録"];

const files = execSync('git ls-files ".pfdsl/*.md"', {
	encoding: "utf8",
	cwd: root,
})
	.trim()
	.split("\n")
	.filter(Boolean);

let errorCount = 0;

for (const file of files) {
	const text = readFileSync(resolve(root, file), "utf-8");
	for (const ref of extractPathReferences(text)) {
		const target = resolveCheckTarget(ref);
		if (target === null) continue; // placeholder, not a concrete path
		if (!existsSync(resolve(root, target))) {
			console.error(`${file}: dead path reference \`${ref}\` (resolved: ${target})`);
			errorCount++;
		}
	}
}

const pfdRetroBindingPath = resolve(root, ".pfdsl/bindings/pfd-retro.md");
if (existsSync(pfdRetroBindingPath)) {
	const text = readFileSync(pfdRetroBindingPath, "utf-8");
	for (const heading of findMissingHeadings(text, REQUIRED_PFD_RETRO_BINDING_HEADINGS)) {
		console.error(
			`.pfdsl/bindings/pfd-retro.md: missing required heading "${heading}" (pfd-retro's audit protocol depends on it)`,
		);
		errorCount++;
	}
}

if (errorCount > 0) {
	console.error(`\ncheck-companion-bindings: ${errorCount} error(s)`);
	process.exit(1);
}
console.log("check-companion-bindings: all passed");
