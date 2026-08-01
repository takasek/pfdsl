#!/usr/bin/env node
// Single source of truth for the gen-skill drift trigger pattern, shared by
// scripts/gate-check.mjs (JS RegExp import) and scripts/pre-commit (a POSIX
// sh script that captures the raw ERE string via command substitution,
// since it cannot `import` JS). Keep this ERE-compatible for `grep -E`.

// examples-index.mjs and sample-companions.mjs are here because they render
// references/examples.md and references/samples.md: a change to either moves
// the generated output while touching nothing else this pattern names, so the
// bundle could go stale with every drift check silently green (#666).
export const GEN_SKILL_TRIGGER_PATTERN =
	"^(docs/|scripts/skill-template/|scripts/gen-skill\\.mjs|scripts/gen-skill-refs\\.mjs|scripts/lib/gen-skill-refs\\.mjs|scripts/lib/examples-index\\.mjs|scripts/lib/sample-companions\\.mjs)";

export const GEN_SKILL_TRIGGER = new RegExp(GEN_SKILL_TRIGGER_PATTERN);

// CLI mode: print the raw ERE pattern string for shell command substitution.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	console.log(GEN_SKILL_TRIGGER_PATTERN);
}
