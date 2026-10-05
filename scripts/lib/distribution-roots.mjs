// Shared distribution boundaries. Keep this data module free of imports so
// Git-only tools do not need the plugin generator's template dependencies.
export const CLAUDE_PLUGIN_ROOT = "plugin/pfdsl";
export const CODEX_PLUGIN_ROOT = "plugin/pfdsl-codex";
export const DISTRIBUTION_ROOTS = Object.freeze([
	CLAUDE_PLUGIN_ROOT,
	CODEX_PLUGIN_ROOT,
]);
