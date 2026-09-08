#!/usr/bin/env node

// Assembles the pfdsl Claude Code plugin at plugin/pfdsl/ and the Codex plugin at plugin/pfdsl-codex/. Run: node scripts/gen-plugin.mjs
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
const codexPluginRoot = resolve(root, "plugin/pfdsl-codex");

function assemble() {
	// --- 1-6. Generate the neutral pfdsl skill and assemble install/ mirror, static skills, commands, agents, hooks, plugin.json, Codex-native skills, and harness copies under one lock and transaction.
	// Shared with scripts/gen-plugin-dist-independent.mjs, which pre-commit drift-checks even when dist is missing/stale (#593).

	assemblePluginDistIndependent({
		root,
		pluginRoot,
		codexPluginRoot,
		generateNeutralSkill: () =>
			execFileSync(
				process.execPath,
				[
					resolve(__dirname, "gen-skill.mjs"),
					"--out",
					resolve(root, "generated/skills/pfdsl"),
				],
				{ stdio: "inherit" },
			),
	});

	console.log(
		"\nPlugins assembled at plugin/pfdsl/ (Claude Code) and plugin/pfdsl-codex/ (Codex). Verify Claude locally with: claude --plugin-dir plugin/pfdsl",
	);
}

try {
	assemble();
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}
