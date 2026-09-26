// The generated-output contract of `node scripts/gen-plugin.mjs`: every path it rewrites, stated once for the drift checks that compare them (#1203).
//
// Three consumers regenerate and then diff these paths — the pre-commit bulk gate (scripts/lib/drift-gates.mjs), the terminal gate-check step (scripts/lib/gate-check-steps.mjs) and the CI workflow (.github/workflows/check-gen-plugin.yml, through scripts/check-generated-drift.mjs --gen-plugin).
// Each used to spell its own list, and the terminal one had shrunk to plugin/ and install/, so a hand edit to AGENTS.md passed the terminal gate even though the regeneration it ran had just undone it.
// The consumers still differ on purpose, and only where another check owns the surface: install/ has its own gen-install gate before the bulk in pre-commit and its own CI workflow (check-pfd-ops-sync.yml), and SKILL.md has the pre-commit gate that alone needs packages/cli/dist.
//
// The entries are roots rather than the individual files the generator snapshots, so an untracked stray file under a generated root is still reported.
// scripts/lib/gen-plugin-outputs.test.mjs holds these roots and the snapshot destinations of a failed generation to each other in both directions.

export const GEN_INSTALL_OUTPUT = ".claude/skills/pfd-ops/install";
export const GEN_SKILL_MD_OUTPUT = "generated/skills/pfdsl/SKILL.md";

export const GEN_PLUGIN_OUTPUTS = Object.freeze([
	"generated",
	"plugin",
	".claude-plugin/marketplace.json",
	"CLAUDE.md",
	"AGENTS.md",
	".agents",
	".codex",
	GEN_INSTALL_OUTPUT,
]);

const WITHOUT_INSTALL = GEN_PLUGIN_OUTPUTS.filter(
	(path) => path !== GEN_INSTALL_OUTPUT,
);

const PATHSPECS_BY_CONSUMER = Object.freeze({
	terminal: GEN_PLUGIN_OUTPUTS,
	ci: WITHOUT_INSTALL,
	"pre-commit": [...WITHOUT_INSTALL, `:(exclude)${GEN_SKILL_MD_OUTPUT}`],
});

/**
 * The pathspecs one consumer diffs after regenerating.
 * @param {"pre-commit" | "terminal" | "ci"} consumer
 * @returns {string[]}
 */
export function genPluginDriftPathspecs(consumer) {
	const pathspecs = Object.hasOwn(PATHSPECS_BY_CONSUMER, consumer)
		? PATHSPECS_BY_CONSUMER[consumer]
		: undefined;
	if (!pathspecs) {
		throw new Error(`Unknown gen-plugin drift consumer: ${consumer}`);
	}
	return [...pathspecs];
}
