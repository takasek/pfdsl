import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Mirrors a whole directory (e.g. a skill tree) from srcRoot/name into
 * destRoot/name. Clears the destination first so files deleted/renamed
 * upstream don't linger — a plain cpSync only adds/overwrites.
 * @param {string} name
 * @param {string} srcRoot
 * @param {string} destRoot
 */
export function mirrorDir(name, srcRoot, destRoot) {
	const src = resolve(srcRoot, name);
	const dest = resolve(destRoot, name);
	if (!existsSync(src)) {
		throw new Error(`${src} not found.`);
	}
	rmSync(dest, { recursive: true, force: true });
	cpSync(src, dest, { recursive: true });
}

/**
 * Mirrors an allowlisted set of individual files from srcDir into destDir.
 * Clears the destination directory first so a file dropped from the
 * allowlist (or renamed upstream) doesn't linger.
 * @param {string[]} names
 * @param {string} srcDir
 * @param {string} destDir
 */
export function mirrorFiles(names, srcDir, destDir) {
	rmSync(destDir, { recursive: true, force: true });
	mkdirSync(destDir, { recursive: true });
	for (const name of names) {
		const src = resolve(srcDir, name);
		if (!existsSync(src)) {
			throw new Error(`${src} not found.`);
		}
		cpSync(src, resolve(destDir, name));
	}
}

// Builds the Claude Code plugin manifest object for .claude-plugin/plugin.json.
// version is derived from packages/cli/package.json so drift (a CLI release
// without a matching plugin.json update) shows up as a diff, not a silent gap.
// Used by scripts/gen-plugin.mjs.

export function buildPluginManifest({ cliVersion }) {
	return {
		name: "pfdsl",
		description:
			"PFD-DSL authoring toolkit: syntax/CLI reference (pfdsl skill), ecosystem bootstrap (pfd-ecosystem skill), project operations (pfd-ops skill), retrospective audit (pfd-retro skill), and /pfd-cycle, /pfd-init commands.",
		version: cliVersion,
		author: { name: "takasek" },
		homepage: "https://github.com/takasek/pfdsl",
		license: "MIT",
	};
}
