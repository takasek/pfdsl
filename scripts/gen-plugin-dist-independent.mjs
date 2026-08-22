#!/usr/bin/env node
// Assembles the Claude and Codex plugin roots except plugin/pfdsl/skills/pfdsl/SKILL.md, which needs packages/cli/dist (embeds `pfdsl help` output — see scripts/gen-skill.mjs).
// Never touches dist or spawns a child process, so scripts/pre-commit can drift-check this bulk even when dist is missing/stale (#593, same split rationale as scripts/lib/gen-skill-refs.mjs in #586).
// Run: node scripts/gen-plugin-dist-independent.mjs

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePluginDistIndependent } from "./lib/gen-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugin/pfdsl");
const codexPluginRoot = resolve(root, "plugin/pfdsl-codex");

try {
	assemblePluginDistIndependent({ root, pluginRoot, codexPluginRoot });
	console.log(
		"\nDist-independent Claude and Codex plugin outputs assembled. plugin/pfdsl/skills/pfdsl/SKILL.md remains the only dist-dependent output; run 'node scripts/gen-skill.mjs --out plugin/pfdsl/skills/pfdsl' to refresh it.",
	);
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}
