// Single source of truth for the gen-skill drift trigger pattern, imported as a
// RegExp by scripts/gate-check.mjs and, through GEN_PLUGIN_TRIGGER_PATTERN, by
// scripts/check-drift-gates.mjs.

// examples-index.mjs and sample-companions.mjs are here because they render
// references/examples.md and references/samples.md: a change to either moves
// the generated output while touching nothing else this pattern names, so the
// bundle could go stale with every drift check silently green (#666).
export const GEN_SKILL_TRIGGER_PATTERN =
	"^(docs/|scripts/skill-template/|scripts/gen-skill\\.mjs|scripts/lib/gen-skill-refs\\.mjs|scripts/lib/examples-index\\.mjs|scripts/lib/sample-companions\\.mjs|scripts/lib/skill-header\\.mjs|scripts/lib/skill-out-dir\\.mjs|scripts/lib/skill-cli-section\\.mjs|scripts/lib/skill-field-drift\\.mjs|scripts/lib/spec-history-check\\.mjs)";

export const GEN_SKILL_TRIGGER = new RegExp(GEN_SKILL_TRIGGER_PATTERN);
