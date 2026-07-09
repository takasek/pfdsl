#!/usr/bin/env node
// Assembles the pfdsl Claude Code plugin at plugin/pfdsl/ for marketplace
// distribution. Run: node scripts/gen-plugin.mjs
//
// plugin/pfdsl/ is a dedicated subdirectory (not the repo root) so that a
// git-subdir marketplace source only materializes this plugin's content —
// not the whole pfdsl monorepo (packages/, docs/, this repo's own dev
// CLAUDE.md, etc). `claude plugin validate` flags a plugin-root CLAUDE.md as
// unshippable context, which is what surfaced this during local verification.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { buildPluginManifest } from "./lib/gen-plugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pluginRoot = resolve(root, "plugin/pfdsl");

// --- 1. Generate the pfdsl skill directly into plugin/pfdsl/skills/pfdsl ---
// (reuses gen-skill.mjs rather than copying skills/pfdsl, so this stays in
// sync even if the two ever diverge in generation logic)

execFileSync(process.execPath, [resolve(__dirname, "gen-skill.mjs"), "--out", resolve(pluginRoot, "skills/pfdsl")], {
	stdio: "inherit",
});

// --- 2. Copy the static skills (pfd-ecosystem, pfd-retro) into skills/ ---

for (const name of ["pfd-ecosystem", "pfd-retro"]) {
	const src = resolve(root, `.claude/skills/${name}`);
	const dest = resolve(pluginRoot, `skills/${name}`);
	if (!existsSync(src)) {
		console.error(`Error: ${src} not found.`);
		process.exit(1);
	}
	cpSync(src, dest, { recursive: true });
	console.log(`plugin/pfdsl/skills/${name} ← .claude/skills/${name}`);
}

// --- 3. Copy the commands (pfd-cycle, pfd-init) into commands/ ---

const commandsDest = resolve(pluginRoot, "commands");
mkdirSync(commandsDest, { recursive: true });
for (const file of ["pfd-cycle.md", "pfd-init.md"]) {
	const src = resolve(root, `.claude/commands/${file}`);
	if (!existsSync(src)) {
		console.error(`Error: ${src} not found.`);
		process.exit(1);
	}
	cpSync(src, resolve(commandsDest, file));
	console.log(`plugin/pfdsl/commands/${file} ← .claude/commands/${file}`);
}

// --- 4. Write plugin/pfdsl/.claude-plugin/plugin.json ---

const cliVersion = JSON.parse(readFileSync(resolve(root, "packages/cli/package.json"), "utf-8")).version;
const manifest = buildPluginManifest({ cliVersion });
const pluginManifestDir = resolve(pluginRoot, ".claude-plugin");
mkdirSync(pluginManifestDir, { recursive: true });
writeFileSync(resolve(pluginManifestDir, "plugin.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
console.log("plugin/pfdsl/.claude-plugin/plugin.json ← packages/cli/package.json version");

console.log("\nPlugin assembled at plugin/pfdsl/. Verify locally with: claude --plugin-dir plugin/pfdsl");
