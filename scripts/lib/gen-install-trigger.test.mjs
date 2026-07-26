import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GEN_INSTALL_TRIGGER } from "./gen-install-trigger.mjs";
import { INSTALL_TEMPLATE_PATHS } from "./install-templates.mjs";

describe("GEN_INSTALL_TRIGGER", () => {
	it("matches every listed template source path", () => {
		for (const p of INSTALL_TEMPLATE_PATHS) {
			assert.equal(GEN_INSTALL_TRIGGER.test(p), true, `expected trigger to match ${p}`);
		}
	});

	it("matches scripts/lib/install-templates.mjs", () => {
		assert.equal(GEN_INSTALL_TRIGGER.test("scripts/lib/install-templates.mjs"), true);
	});

	it("matches scripts/lib/gen-install.mjs", () => {
		assert.equal(GEN_INSTALL_TRIGGER.test("scripts/lib/gen-install.mjs"), true);
	});

	it("matches scripts/gen-install.mjs", () => {
		assert.equal(GEN_INSTALL_TRIGGER.test("scripts/gen-install.mjs"), true);
	});

	it("matches a hand-edit to the generated install/ tree", () => {
		assert.equal(GEN_INSTALL_TRIGGER.test(".claude/skills/pfd-ops/install/scripts/pfdsl/lib/gh-compat.mjs"), true);
	});

	it("does not match an unrelated root-level file", () => {
		assert.equal(GEN_INSTALL_TRIGGER.test("README.md"), false);
	});

	it("does not match an unrelated scripts/pfdsl file outside the template list", () => {
		assert.equal(GEN_INSTALL_TRIGGER.test("scripts/pfdsl/lib/gh-exec.test.mjs"), false);
	});
});
