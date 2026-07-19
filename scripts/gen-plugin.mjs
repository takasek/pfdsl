#!/usr/bin/env node
// Assembles the pfdsl Claude Code plugin at plugin/pfdsl/ for marketplace
// distribution. Run: node scripts/gen-plugin.mjs
//
// plugin/pfdsl/ is a dedicated subdirectory (not the repo root) so that a
// git-subdir marketplace source only materializes this plugin's content —
// not the whole pfdsl monorepo (packages/, docs/, this repo's own dev
// CLAUDE.md, etc). `claude plugin validate` flags a plugin-root CLAUDE.md as
// unshippable context, which is what surfaced this during local verification.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { buildPluginManifest, mirrorDir, mirrorFiles } from "./lib/gen-plugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pluginRoot = resolve(root, "plugin/pfdsl");

function assemble() {
	// --- 1. Generate the pfdsl skill directly into plugin/pfdsl/skills/pfdsl ---
	// (reuses gen-skill.mjs rather than copying skills/pfdsl, so this stays in
	// sync even if the two ever diverge in generation logic)

	execFileSync(process.execPath, [resolve(__dirname, "gen-skill.mjs"), "--out", resolve(pluginRoot, "skills/pfdsl")], {
		stdio: "inherit",
	});

	// --- 2. Copy the static skills (pfd-ecosystem, pfd-ops, pfd-retro, pfd-grill) into skills/ ---

	for (const name of ["pfd-ecosystem", "pfd-ops", "pfd-retro", "pfd-grill"]) {
		mirrorDir(name, resolve(root, ".claude/skills"), resolve(pluginRoot, "skills"));
		console.log(`plugin/pfdsl/skills/${name} ← .claude/skills/${name}`);
	}

	// --- 3. Copy the commands (pfd-cycle, pfd-init, pfd-retro) into commands/ ---

	const commandFiles = ["pfd-cycle.md", "pfd-init.md", "pfd-retro.md"];
	mirrorFiles(commandFiles, resolve(root, ".claude/commands"), resolve(pluginRoot, "commands"));
	for (const file of commandFiles) {
		console.log(`plugin/pfdsl/commands/${file} ← .claude/commands/${file}`);
	}

	// --- 4. Copy the agents (pfd-lens) into agents/ ---
	// pfd-retro's SKILL.md delegates large-diagram audits to the pfd-lens agent
	// (.claude/agents/pfd-lens.md); without it bundled, that delegation path is
	// unreachable for plugin-only installs.

	const agentFiles = ["pfd-lens.md"];
	mirrorFiles(agentFiles, resolve(root, ".claude/agents"), resolve(pluginRoot, "agents"));
	for (const file of agentFiles) {
		console.log(`plugin/pfdsl/agents/${file} ← .claude/agents/${file}`);
	}

	// --- 5. Copy the plugin hooks (retro reminder, #465) into hooks/ ---

	mirrorDir("hooks", root, pluginRoot);
	console.log("plugin/pfdsl/hooks ← hooks");

	// --- 6. Write plugin/pfdsl/.claude-plugin/plugin.json ---

	const cliVersion = JSON.parse(readFileSync(resolve(root, "packages/cli/package.json"), "utf-8")).version;
	const manifest = buildPluginManifest({ cliVersion });
	const pluginManifestDir = resolve(pluginRoot, ".claude-plugin");
	mkdirSync(pluginManifestDir, { recursive: true });
	writeFileSync(resolve(pluginManifestDir, "plugin.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log("plugin/pfdsl/.claude-plugin/plugin.json ← packages/cli/package.json version");

	console.log("\nPlugin assembled at plugin/pfdsl/. Verify locally with: claude --plugin-dir plugin/pfdsl");
}

try {
	assemble();
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}
