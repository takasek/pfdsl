// Single source of truth for the gen-install drift trigger pattern, imported
// as a RegExp by scripts/check-drift-gates.mjs.
//
// Fires on: any template source path (#547 — editing the hand-edited side
// must regenerate install/), the generator's own sources (list, lib, CLI),
// and the generated install/ tree itself (so a hand-edit to the generated
// side is caught and overwritten too).

import { INSTALL_TEMPLATE_PATHS } from "./install-templates.mjs";

const escapeDots = (s) => s.replace(/\./g, "\\.");

const GEN_INSTALL_TRIGGER_PATTERN = [
	...INSTALL_TEMPLATE_PATHS.map(escapeDots),
	"scripts/lib/install-templates\\.mjs",
	"scripts/lib/gen-install\\.mjs",
	"scripts/lib/relative-imports\\.mjs",
	"scripts/gen-install\\.mjs",
	"^\\.claude/skills/pfd-ops/install/",
].join("|");

export const GEN_INSTALL_TRIGGER = new RegExp(GEN_INSTALL_TRIGGER_PATTERN);
