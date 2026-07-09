#!/usr/bin/env node
// Single source of truth for the gen-plugin drift trigger pattern, shared by
// scripts/gate-check.mjs (JS RegExp import) and scripts/pre-commit (a POSIX
// sh script that captures the raw ERE string via command substitution,
// since it cannot `import` JS). Keep this ERE-compatible for `grep -E`.
//
// Superset of GEN_SKILL_TRIGGER: gen-plugin.mjs re-runs gen-skill.mjs
// internally (see scripts/gen-plugin.mjs), plus bundles pfd-ecosystem/
// pfd-retro/pfd-cycle/pfd-init and derives plugin.json's version from the
// CLI package.json.

import { GEN_SKILL_TRIGGER_PATTERN } from "./gen-skill-trigger.mjs";

export const GEN_PLUGIN_TRIGGER_PATTERN = `${GEN_SKILL_TRIGGER_PATTERN}|scripts/gen-plugin\\.mjs|scripts/lib/gen-plugin\\.mjs|\\.claude/skills/pfd-ecosystem/|\\.claude/skills/pfd-retro/|\\.claude/commands/pfd-cycle\\.md|\\.claude/commands/pfd-init\\.md|packages/cli/package\\.json`;

export const GEN_PLUGIN_TRIGGER = new RegExp(GEN_PLUGIN_TRIGGER_PATTERN);

// CLI mode: print the raw ERE pattern string for shell command substitution.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	console.log(GEN_PLUGIN_TRIGGER_PATTERN);
}
