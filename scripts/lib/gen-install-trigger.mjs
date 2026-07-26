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

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
// realpathSync (not a raw string compare) matters here: on macOS, import.meta.url
// reflects the ESM loader's realpath-resolved location (e.g. /tmp -> /private/tmp),
// so a plain argv[1] comparison mismatches when the invocation path crosses a symlink.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	console.log(GEN_INSTALL_TRIGGER_PATTERN);
}
