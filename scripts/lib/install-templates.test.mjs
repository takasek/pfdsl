// Repo-level (not tmpdir) test: asserts INSTALL_TEMPLATE_PATHS matches what
// actually exists on disk under .claude/skills/pfd-ops/install/. This list is
// hand-maintained (see install-templates.mjs for why), so nothing else would
// catch a template added to install/ without updating the list, or vice
// versa — both are silent-drift failure modes #547 exists to prevent.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listInstallFiles } from "../../.claude/skills/pfd-ops/scripts/check-install-sync.mjs";
import { INSTALL_TEMPLATE_PATHS } from "./install-templates.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const installDir = resolve(root, ".claude/skills/pfd-ops/install");

describe("INSTALL_TEMPLATE_PATHS", () => {
	it("matches exactly what exists under .claude/skills/pfd-ops/install/", () => {
		assert.deepEqual([...INSTALL_TEMPLATE_PATHS].sort(), listInstallFiles(installDir));
	});
});
