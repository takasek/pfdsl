import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

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
			"PFD-DSL authoring toolkit: syntax/CLI reference (pfdsl skill), ecosystem bootstrap (pfd-ecosystem skill), project operations (pfd-ops skill), retrospective audit (pfd-retro skill), backward-dialogue diagram construction (pfd-grill skill), and /pfd-cycle, /pfd-init commands.",
		version: cliVersion,
		author: { name: "takasek" },
		homepage: "https://github.com/takasek/pfdsl",
		license: "MIT",
	};
}
