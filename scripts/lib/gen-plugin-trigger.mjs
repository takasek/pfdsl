#!/usr/bin/env node
// Single source of truth for the gen-plugin drift trigger pattern, shared by
// scripts/gate-check.mjs (JS RegExp import) and scripts/pre-commit (a POSIX
// sh script that captures the raw ERE string via command substitution,
// since it cannot `import` JS). Keep this ERE-compatible for `grep -E`.
//
// Superset of GEN_SKILL_TRIGGER: gen-plugin.mjs re-runs gen-skill.mjs
// internally (see scripts/gen-plugin.mjs), plus bundles pfd-ecosystem/
// pfd-ops/pfd-retro/pfd-cycle/pfd-init/pfd-lens and derives plugin.json's
// version from the CLI package.json.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GEN_SKILL_TRIGGER_PATTERN } from "./gen-skill-trigger.mjs";

export const GEN_PLUGIN_TRIGGER_PATTERN = `${GEN_SKILL_TRIGGER_PATTERN}|scripts/gen-plugin\\.mjs|scripts/lib/gen-plugin\\.mjs|\\.claude/skills/pfd-ecosystem/|\\.claude/skills/pfd-ops/|\\.claude/skills/pfd-retro/|\\.claude/commands/pfd-cycle\\.md|\\.claude/commands/pfd-init\\.md|\\.claude/commands/pfd-retro\\.md|\\.claude/agents/pfd-lens\\.md|^hooks/|packages/cli/package\\.json`;

export const GEN_PLUGIN_TRIGGER = new RegExp(GEN_PLUGIN_TRIGGER_PATTERN);

// CLI mode: print the raw ERE pattern string for shell command substitution.
// realpathSync (not a raw string compare) matters here: on macOS, import.meta.url
// reflects the ESM loader's realpath-resolved location (e.g. /tmp -> /private/tmp),
// so a plain argv[1] comparison mismatches when the invocation path crosses a symlink.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	console.log(GEN_PLUGIN_TRIGGER_PATTERN);
}
