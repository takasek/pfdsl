#!/usr/bin/env node
// Single source of truth for the gen-install drift trigger pattern, shared
// by scripts/pre-commit (a POSIX sh script that captures the raw ERE string
// via command substitution, since it cannot `import` JS). Keep this
// ERE-compatible for `grep -E`.
//
// Fires on: any template source path (#547 — editing the hand-edited side
// must regenerate install/), the generator's own sources (list, lib, CLI),
// and the generated install/ tree itself (so a hand-edit to the generated
// side is caught and overwritten too).

import { isCliEntrypoint } from "./cli-entrypoint.mjs";
import { INSTALL_TEMPLATE_PATHS } from "./install-templates.mjs";

const escapeEre = (s) => s.replace(/\./g, "\\.");

export const GEN_INSTALL_TRIGGER_PATTERN = [
	...INSTALL_TEMPLATE_PATHS.map(escapeEre),
	"scripts/lib/install-templates\\.mjs",
	"scripts/lib/gen-install\\.mjs",
	"scripts/gen-install\\.mjs",
	"^\\.claude/skills/pfd-ops/install/",
].join("|");

export const GEN_INSTALL_TRIGGER = new RegExp(GEN_INSTALL_TRIGGER_PATTERN);

// CLI mode: print the raw ERE pattern string for shell command substitution.
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	console.log(GEN_INSTALL_TRIGGER_PATTERN);
}
