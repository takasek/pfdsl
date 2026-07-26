#!/usr/bin/env node
// CLI wrapper for genInstall (#547): regenerates
// .claude/skills/pfd-ops/install/** from the repo-root sources listed in
// scripts/lib/install-templates.mjs. install/ is a generated mirror — edit
// the repo-root source and run this (or `make gen-install`), never the
// generated side directly.
//
// Usage: node scripts/gen-install.mjs

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { genInstall } from "./lib/gen-install.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function printGroup(title, items) {
	if (items.length === 0) return;
	console.log(title);
	for (const item of items) console.log(`  ${item}`);
}

try {
	const { changed, unchanged, removed } = genInstall(root);
	printGroup("Changed:", changed);
	printGroup("Removed:", removed);
	if (changed.length === 0 && removed.length === 0) {
		console.log(`.claude/skills/pfd-ops/install/ already up to date (${unchanged.length} file(s)).`);
	} else {
		console.log(
			`.claude/skills/pfd-ops/install/ regenerated (${changed.length} changed, ${removed.length} removed, ${unchanged.length} unchanged).`,
		);
	}
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}
