#!/usr/bin/env node
// Single source of truth for the gen-plugin drift trigger pattern, shared by
// scripts/gate-check.mjs (JS RegExp import) and scripts/pre-commit (a POSIX
// sh script that captures the raw ERE string via command substitution,
// since it cannot `import` JS). Keep this ERE-compatible for `grep -E`.
//
// Superset of GEN_SKILL_TRIGGER: gen-plugin.mjs re-runs gen-skill.mjs
// internally (see scripts/gen-plugin.mjs), plus bundles pfd-grill/
// pfd-ops/pfd-retro/pfd-ecosystem/pfd-cycle/pfd-init plus the bundled agents
// (PLUGIN_AGENT_FILES), and derives plugin.json's version from the CLI
// package.json.
//
// Includes scripts/gen-plugin-dist-independent.mjs (#593, split rationale
// in scripts/lib/gen-plugin.mjs's assemblePluginDistIndependent): a change
// to it is itself a drift-check target, so it must trigger the same
// check_drift that regenerates and diffs plugin/ in scripts/pre-commit.
// Its own gen-install.mjs dependency doesn't need adding here — that's
// already covered by GEN_INSTALL_TRIGGER's own check_drift in
// scripts/pre-commit, and a gen-install change can't affect plugin/'s
// contents (install/ lives outside plugin/pfdsl/).

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GEN_SKILL_TRIGGER_PATTERN } from "./gen-skill-trigger.mjs";
import { PLUGIN_AGENT_FILES } from "./gen-plugin.mjs";

const AGENT_PATTERNS = PLUGIN_AGENT_FILES.map((file) => `\\.claude/agents/${file.replace(/\./g, "\\.")}`).join("|");

export const GEN_PLUGIN_TRIGGER_PATTERN = `${GEN_SKILL_TRIGGER_PATTERN}|scripts/gen-plugin\\.mjs|scripts/lib/gen-plugin\\.mjs|scripts/gen-plugin-dist-independent\\.mjs|\\.claude/skills/pfd-ecosystem/|\\.claude/skills/pfd-ops/|\\.claude/skills/pfd-retro/|\\.claude/skills/pfd-grill/|\\.claude/commands/pfd-cycle\\.md|\\.claude/commands/pfd-init\\.md|\\.claude/commands/pfd-retro\\.md|${AGENT_PATTERNS}|^hooks/|packages/cli/package\\.json`;

export const GEN_PLUGIN_TRIGGER = new RegExp(GEN_PLUGIN_TRIGGER_PATTERN);

// CLI mode: print the raw ERE pattern string for shell command substitution.
// realpathSync (not a raw string compare) matters here: on macOS, import.meta.url
// reflects the ESM loader's realpath-resolved location (e.g. /tmp -> /private/tmp),
// so a plain argv[1] comparison mismatches when the invocation path crosses a symlink.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	console.log(GEN_PLUGIN_TRIGGER_PATTERN);
}
