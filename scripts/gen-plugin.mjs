#!/usr/bin/env node
// Assembles the pfdsl Claude Code plugin for marketplace distribution.
// Run: node scripts/gen-plugin.mjs
// Prerequisite: `make gen-skill` (skills/pfdsl must already be up to date —
// this script does not regenerate it, only bundles it with the other skills).

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPluginManifest } from "./lib/gen-plugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// --- 1. Confirm skills/pfdsl (gen-skill output) is present ---

const pfdslSkillDir = resolve(root, "skills/pfdsl");
if (!existsSync(pfdslSkillDir)) {
	console.error("Error: skills/pfdsl not found. Run 'make gen-skill' first.");
	process.exit(1);
}

// --- 2. Copy the static skills (pfd-ecosystem, pfd-retro) into skills/ ---

for (const name of ["pfd-ecosystem", "pfd-retro"]) {
	const src = resolve(root, `.claude/skills/${name}`);
	const dest = resolve(root, `skills/${name}`);
	if (!existsSync(src)) {
		console.error(`Error: ${src} not found.`);
		process.exit(1);
	}
	cpSync(src, dest, { recursive: true });
	console.log(`skills/${name} ← .claude/skills/${name}`);
}

// --- 3. Copy the commands (pfd-cycle, pfd-init) into commands/ ---

const commandsDest = resolve(root, "commands");
mkdirSync(commandsDest, { recursive: true });
for (const file of ["pfd-cycle.md", "pfd-init.md"]) {
	const src = resolve(root, `.claude/commands/${file}`);
	if (!existsSync(src)) {
		console.error(`Error: ${src} not found.`);
		process.exit(1);
	}
	cpSync(src, resolve(commandsDest, file));
	console.log(`commands/${file} ← .claude/commands/${file}`);
}

// --- 4. Write .claude-plugin/plugin.json ---

const cliVersion = JSON.parse(readFileSync(resolve(root, "packages/cli/package.json"), "utf-8")).version;
const manifest = buildPluginManifest({ cliVersion });
const pluginDir = resolve(root, ".claude-plugin");
mkdirSync(pluginDir, { recursive: true });
writeFileSync(resolve(pluginDir, "plugin.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
console.log(".claude-plugin/plugin.json ← packages/cli/package.json version");

console.log("\nPlugin assembled at repo root. Verify locally with: claude --plugin-dir .");
