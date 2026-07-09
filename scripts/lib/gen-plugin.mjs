// Builds the Claude Code plugin manifest object for .claude-plugin/plugin.json.
// version is derived from packages/cli/package.json so drift (a CLI release
// without a matching plugin.json update) shows up as a diff, not a silent gap.
// Used by scripts/gen-plugin.mjs.

export function buildPluginManifest({ cliVersion }) {
	return {
		name: "pfdsl",
		description:
			"PFD-DSL authoring toolkit: syntax/CLI reference (pfdsl skill), ecosystem bootstrap (pfd-ecosystem skill), retrospective audit (pfd-retro skill), and /pfd-cycle, /pfd-init commands.",
		version: cliVersion,
		author: { name: "takasek" },
		homepage: "https://github.com/takasek/pfdsl",
		license: "MIT",
	};
}
