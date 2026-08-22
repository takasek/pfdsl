// Bundled files rendered from another source rather than mirrored verbatim.
// This mapping is shared by the distribution reviewer and Codex ownership
// notices so both send maintainers to the same editable source.
export const GENERATED_DISTRIBUTION_SOURCES = Object.freeze({
	"plugin/pfdsl-codex/GENERATED.md": "scripts/lib/gen-plugin.mjs",
	"plugin/pfdsl/skills/pfdsl/SKILL.md": "scripts/skill-template/SKILL.md",
	"plugin/pfdsl/skills/pfdsl/references/spec.md": "docs/spec/spec.md",
	"plugin/pfdsl/skills/pfdsl/references/quality-guide.md":
		"docs/quality-guide.md",
	"plugin/pfdsl/skills/pfdsl/references/review-perspectives.md":
		"docs/review-perspectives.md",
	// Aggregated from many files, so the pointer is the directory: no single
	// source file answers "where does this line come from".
	"plugin/pfdsl/skills/pfdsl/references/examples.md": "docs/examples/",
	"plugin/pfdsl/skills/pfdsl/references/samples.md": "docs/samples/",
});

export function canonicalPluginSkillSource(relativePath) {
	return (
		GENERATED_DISTRIBUTION_SOURCES[`plugin/pfdsl/skills/${relativePath}`] ??
		`.claude/skills/${relativePath}`
	);
}
