// Single source of truth for the gen-plugin drift trigger pattern, imported as
// a RegExp by scripts/gate-check.mjs and scripts/check-drift-gates.mjs.
//
// Superset of GEN_SKILL_TRIGGER: gen-plugin.mjs re-runs gen-skill.mjs
// internally (see scripts/gen-plugin.mjs), plus bundles pfd-grill/
// pfd-ops/pfd-retro/pfd-ecosystem/pfd-cycle/pfd-init plus the bundled agents
// (PLUGIN_AGENT_FILES), and derives plugin.json's version from the CLI
// package.json.
//
// Includes scripts/gen-plugin-dist-independent.mjs (#593, split rationale
// in scripts/lib/gen-plugin.mjs's assemblePluginDistIndependent): a change
// to it is itself a drift-check target, so it must trigger the same gate
// that regenerates and diffs plugin/ in scripts/check-drift-gates.mjs.
// Its own gen-install.mjs dependency doesn't need adding here — not because
// gen-install can't affect plugin/'s contents (it can: mirrorDir("pfd-ops",
// …) in scripts/lib/gen-plugin.mjs copies the whole pfd-ops skill tree,
// install/ included, into plugin/pfdsl/skills/pfd-ops/install/), but because
// a template-source-only change is already blocked by GEN_INSTALL_TRIGGER's
// own gate, declared ahead of these in scripts/check-drift-gates.mjs, until install/ is
// regenerated and re-staged too — and that staged install/ path itself
// matches this pattern's `\.claude/skills/pfd-ops/` alternative.

import {
	PLUGIN_AGENT_FILES,
	PLUGIN_COMMAND_FILES,
	PLUGIN_SKILL_DIRS,
} from "./gen-plugin.mjs";
import { GEN_SKILL_TRIGGER_PATTERN } from "./gen-skill-trigger.mjs";

// All three alternations are derived from the same lists gen-plugin bundles
// from, so adding a skill, command or agent cannot land in the assembly and be
// forgotten in the drift trigger.
const escapeDots = (name) => name.replace(/\./g, "\\.");
const AGENT_PATTERNS = PLUGIN_AGENT_FILES.map(
	(file) => `\\.claude/agents/${escapeDots(file)}`,
).join("|");
const SKILL_PATTERNS = PLUGIN_SKILL_DIRS.map(
	(dir) => `\\.claude/skills/${escapeDots(dir)}/`,
).join("|");
const COMMAND_PATTERNS = PLUGIN_COMMAND_FILES.map(
	(file) => `\\.claude/commands/${escapeDots(file)}`,
).join("|");

// `^plugin/` covers the generated side, mirroring what GEN_INSTALL_TRIGGER
// already does for install/: a hand-edit there is about to be overwritten by
// the next assembly, and the drift gate is what tells the author so instead of
// letting the edit ship and then vanish (#666, same shape as #579).
// `.claude-plugin/marketplace\.json` joins it for the same reason: its
// per-plugin description is generated (assemblePluginDistIndependent, #685)
// even though the file lives outside plugin/pfdsl/.
const GEN_PLUGIN_TRIGGER_PATTERN = `${GEN_SKILL_TRIGGER_PATTERN}|scripts/gen-plugin\\.mjs|scripts/lib/gen-plugin\\.mjs|scripts/lib/bundle-manifest\\.mjs|scripts/gen-plugin-dist-independent\\.mjs|${SKILL_PATTERNS}|${COMMAND_PATTERNS}|${AGENT_PATTERNS}|^hooks/|^plugin/|packages/cli/package\\.json|^\\.claude-plugin/marketplace\\.json`;

export const GEN_PLUGIN_TRIGGER = new RegExp(GEN_PLUGIN_TRIGGER_PATTERN);
