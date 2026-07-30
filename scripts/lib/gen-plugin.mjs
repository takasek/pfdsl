import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { genInstall } from "./gen-install.mjs";
import { writeSkillRefs } from "./gen-skill-refs.mjs";

// The agents bundled into plugin/pfdsl/agents/, as .claude/agents/-relative
// filenames. Single source of truth: gen-plugin.mjs mirrors this list, and
// gen-plugin-trigger.mjs derives its drift-trigger alternation from it, so
// adding an agent cannot land in one place and be forgotten in the other.
export const PLUGIN_AGENT_FILES = ["pfd-lens.md", "pfd-implementer.md"];

// Agents that stay out of the bundle, with why — an adopting repo gets the
// pfd-* ones because they operate on the .pfdsl files it now has, and nothing
// else. Named rather than merely absent so a drift test can require every file
// in .claude/agents/ to be either bundled or listed here (#613).
export const PLUGIN_AGENT_EXCLUSIONS = {
	"ci-triage.md": "reads this repo's GitHub Actions logs",
	"issue-worker.md": "encodes this repo's worktree and PR conventions",
	"vscode-ext-debugger.md": "debugs the extension this repo builds",
};

function requireExists(path) {
	if (!existsSync(path)) {
		throw new Error(`${path} not found.`);
	}
}

// Excludes a skill-root CLAUDE.md (a dev-repo-only guard — e.g. "run make
// gen-skill" instructions that only make sense in this repo) from a mirrored
// copy. Mirrors the exclusion the deleted skill-sync.ts's copySkillTree used
// to apply uniformly to every bundled skill tree.
function excludeSkillRootClaudeMd(skillRoot) {
	return (source) => basename(source) !== "CLAUDE.md" || dirname(source) !== skillRoot;
}

/**
 * Mirrors a whole directory (e.g. a skill tree) from srcRoot/name into
 * destRoot/name, excluding any CLAUDE.md living directly at the source
 * root (see excludeSkillRootClaudeMd). Copies into a temporary sibling
 * path first and only replaces the destination once the copy fully
 * succeeds — a plain rm-then-cp would otherwise leave the destination
 * empty/partial if cpSync fails partway (disk full, a source file
 * becoming unreadable mid-copy, concurrent deletion).
 * @param {string} name
 * @param {string} srcRoot
 * @param {string} destRoot
 */
export function mirrorDir(name, srcRoot, destRoot) {
	const src = resolve(srcRoot, name);
	const dest = resolve(destRoot, name);
	requireExists(src);
	const tempDest = resolve(destRoot, `.${name}.mirror-tmp`);
	rmSync(tempDest, { recursive: true, force: true });
	cpSync(src, tempDest, { recursive: true, filter: excludeSkillRootClaudeMd(src) });
	rmSync(dest, { recursive: true, force: true });
	renameSync(tempDest, dest);
}

/**
 * Mirrors an allowlisted set of individual files from srcDir into destDir.
 * Copies into a temporary sibling directory first and only replaces destDir
 * once every named file has copied successfully, so a failure partway
 * through the list (missing/unreadable file) leaves the prior destination
 * untouched instead of half-populated.
 * @param {string[]} names
 * @param {string} srcDir
 * @param {string} destDir
 */
export function mirrorFiles(names, srcDir, destDir) {
	const tempDestDir = `${destDir}.mirror-tmp`;
	rmSync(tempDestDir, { recursive: true, force: true });
	mkdirSync(tempDestDir, { recursive: true });
	for (const name of names) {
		const src = resolve(srcDir, name);
		requireExists(src);
		cpSync(src, resolve(tempDestDir, name));
	}
	rmSync(destDir, { recursive: true, force: true });
	renameSync(tempDestDir, destDir);
}

// Builds the Claude Code plugin manifest object for .claude-plugin/plugin.json.
// version is derived from packages/cli/package.json so drift (a CLI release
// without a matching plugin.json update) shows up as a diff, not a silent gap.
// Used by scripts/gen-plugin.mjs.

export function buildPluginManifest({ cliVersion }) {
	return {
		name: "pfdsl",
		description:
			"PFD-DSL authoring toolkit: syntax/CLI reference (pfdsl skill), backward-dialogue diagram construction (pfd-grill skill), project operations (pfd-ops skill), retrospective audit (pfd-retro skill), ecosystem bootstrap (pfd-ecosystem skill), and /pfd-cycle, /pfd-init commands.",
		version: cliVersion,
		author: { name: "takasek" },
		homepage: "https://github.com/takasek/pfdsl",
		license: "MIT",
	};
}

// Assembles everything gen-plugin.mjs bundles into plugin/pfdsl/ except
// plugin/pfdsl/skills/pfdsl/SKILL.md (which embeds `pfdsl help` output and
// therefore needs packages/cli/dist — see scripts/gen-skill.mjs). None of
// this touches dist or spawns a child process, so scripts/pre-commit can
// drift-check it even when dist is missing/stale (#593, same split
// rationale as writeSkillRefs in #586). deps defaults to the real
// implementations; tests inject fakes to assert the wiring without touching
// the filesystem.
export function assemblePluginDistIndependent({
	root,
	pluginRoot,
	deps = {
		genInstall,
		mirrorDir,
		mirrorFiles,
		writeSkillRefs,
		readFileSync,
		writeFileSync,
		mkdirSync,
	},
}) {
	deps.genInstall(root);
	console.log(".claude/skills/pfd-ops/install ← repo-root sources (gen-install)");

	for (const name of ["pfd-grill", "pfd-ops", "pfd-retro", "pfd-ecosystem"]) {
		deps.mirrorDir(name, resolve(root, ".claude/skills"), resolve(pluginRoot, "skills"));
		console.log(`plugin/pfdsl/skills/${name} ← .claude/skills/${name}`);
	}

	const commandFiles = ["pfd-cycle.md", "pfd-init.md", "pfd-retro.md"];
	deps.mirrorFiles(commandFiles, resolve(root, ".claude/commands"), resolve(pluginRoot, "commands"));
	for (const file of commandFiles) {
		console.log(`plugin/pfdsl/commands/${file} ← .claude/commands/${file}`);
	}

	deps.mirrorFiles(PLUGIN_AGENT_FILES, resolve(root, ".claude/agents"), resolve(pluginRoot, "agents"));
	for (const file of PLUGIN_AGENT_FILES) {
		console.log(`plugin/pfdsl/agents/${file} ← .claude/agents/${file}`);
	}

	deps.mirrorDir("hooks", root, pluginRoot);
	console.log("plugin/pfdsl/hooks ← hooks");

	const cliVersion = JSON.parse(deps.readFileSync(resolve(root, "packages/cli/package.json"), "utf-8")).version;
	const manifest = buildPluginManifest({ cliVersion });
	const pluginManifestDir = resolve(pluginRoot, ".claude-plugin");
	deps.mkdirSync(pluginManifestDir, { recursive: true });
	deps.writeFileSync(resolve(pluginManifestDir, "plugin.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log("plugin/pfdsl/.claude-plugin/plugin.json ← packages/cli/package.json version");

	deps.writeSkillRefs(root, resolve(pluginRoot, "skills/pfdsl"));
}
