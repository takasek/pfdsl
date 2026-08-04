#!/usr/bin/env node

// Assembles the pfdsl Claude Code plugin at plugin/pfdsl/ for marketplace
// distribution. Run: node scripts/gen-plugin.mjs
//
// plugin/pfdsl/ is a dedicated subdirectory (not the repo root) so that a
// git-subdir marketplace source only materializes this plugin's content —
// not the whole pfdsl monorepo (packages/, docs/, this repo's own dev
// CLAUDE.md, etc). `claude plugin validate` flags a plugin-root CLAUDE.md as
// unshippable context, which is what surfaced this during local verification.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePluginDistIndependent } from "./lib/gen-plugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pluginRoot = resolve(root, "plugin/pfdsl");

function assemble() {
	// --- 1. Generate the pfdsl skill directly into plugin/pfdsl/skills/pfdsl ---
	// (reuses gen-skill.mjs rather than copying skills/pfdsl, so this stays in
	// sync even if the two ever diverge in generation logic). This is the only
	// step that needs packages/cli/dist (it embeds `pfdsl help` output into
	// SKILL.md) — everything else is dist-independent (#593).

	execFileSync(
		process.execPath,
		[
			resolve(__dirname, "gen-skill.mjs"),
			"--out",
			resolve(pluginRoot, "skills/pfdsl"),
		],
		{
			stdio: "inherit",
		},
	);

	// --- 1b-6. Everything else: install/ mirror, static skills, commands,
	// agents, hooks, plugin.json, and skills/pfdsl/references. Shared with
	// scripts/gen-plugin-dist-independent.mjs, which pre-commit drift-checks
	// even when dist is missing/stale (#593).

	assemblePluginDistIndependent({ root, pluginRoot });

	console.log(
		"\nPlugin assembled at plugin/pfdsl/. Verify locally with: claude --plugin-dir plugin/pfdsl",
	);
}

try {
	assemble();
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}
