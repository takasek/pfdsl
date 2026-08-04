#!/usr/bin/env node
// Assembles everything gen-plugin.mjs bundles into plugin/pfdsl/ except
// plugin/pfdsl/skills/pfdsl/SKILL.md, which needs packages/cli/dist (embeds
// `pfdsl help` output — see scripts/gen-skill.mjs). Never touches dist or
// spawns a child process, so scripts/pre-commit can drift-check this bulk
// even when dist is missing/stale (#593, same split rationale as
// scripts/lib/gen-skill-refs.mjs in #586).
// Run: node scripts/gen-plugin-dist-independent.mjs

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assemblePluginDistIndependent } from "./lib/gen-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugin/pfdsl");

try {
	assemblePluginDistIndependent({ root, pluginRoot });
	console.log(
		"\nDist-independent portion of plugin/pfdsl/ assembled (skills/pfdsl/SKILL.md excluded — run 'node scripts/gen-skill.mjs --out plugin/pfdsl/skills/pfdsl' for that).",
	);
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}
