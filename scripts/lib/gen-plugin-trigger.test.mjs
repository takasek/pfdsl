import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GEN_PLUGIN_TRIGGER } from "./gen-plugin-trigger.mjs";

describe("GEN_PLUGIN_TRIGGER", () => {
	it("matches everything GEN_SKILL_TRIGGER matches (docs/ path)", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("docs/foo.md"), true);
	});

	it("matches scripts/gen-plugin.mjs", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("scripts/gen-plugin.mjs"), true);
	});

	it("matches scripts/lib/gen-plugin.mjs", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("scripts/lib/gen-plugin.mjs"), true);
	});

	it("matches a .claude/skills/pfd-ecosystem/ path", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-ecosystem/SKILL.md"), true);
	});

	it("matches a .claude/skills/pfd-retro/ path", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-retro/SKILL.md"), true);
	});

	it("matches .claude/commands/pfd-cycle.md", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/commands/pfd-cycle.md"), true);
	});

	it("matches .claude/commands/pfd-init.md", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/commands/pfd-init.md"), true);
	});

	it("matches .claude/commands/pfd-retro.md", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/commands/pfd-retro.md"), true);
	});

	it("matches .claude/agents/pfd-lens.md", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/agents/pfd-lens.md"), true);
	});

	it("matches packages/cli/package.json", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("packages/cli/package.json"), true);
	});

	it("does not match an unrelated root-level README.md", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("README.md"), false);
	});

	it("matches a .claude/skills/pfd-ops/ path", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-ops/SKILL.md"), true);
	});

	it("does not match an unrelated root-level file", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("packages/core/src/index.ts"), false);
	});
});
