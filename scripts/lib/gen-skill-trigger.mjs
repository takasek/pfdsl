#!/usr/bin/env node
// Single source of truth for the gen-skill drift trigger pattern, shared by
// scripts/gate-check.mjs (JS RegExp import) and scripts/pre-commit (a POSIX
// sh script that captures the raw ERE string via command substitution,
// since it cannot `import` JS). Keep this ERE-compatible for `grep -E`.

export const GEN_SKILL_TRIGGER_PATTERN = "^(docs/|scripts/skill-template/|scripts/gen-skill\\.mjs)";

export const GEN_SKILL_TRIGGER = new RegExp(GEN_SKILL_TRIGGER_PATTERN);

// CLI mode: print the raw ERE pattern string for shell command substitution.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	console.log(GEN_SKILL_TRIGGER_PATTERN);
}
