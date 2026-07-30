import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GEN_PLUGIN_TRIGGER } from "./gen-plugin-trigger.mjs";
import { PLUGIN_AGENT_FILES } from "./gen-plugin.mjs";

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

	it("matches scripts/gen-plugin-dist-independent.mjs", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("scripts/gen-plugin-dist-independent.mjs"), true);
	});

	it("matches a .claude/skills/pfd-ecosystem/ path", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-ecosystem/SKILL.md"), true);
	});

	it("matches a .claude/skills/pfd-retro/ path", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-retro/SKILL.md"), true);
	});

	it("matches a .claude/skills/pfd-grill/ path", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-grill/SKILL.md"), true);
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

	// Whether PLUGIN_AGENT_FILES itself lists every agent that should ship is a
	// different question, checked against .claude/agents/ in
	// intentional-duplication.test.mjs (#613).
	it("matches each agent file PLUGIN_AGENT_FILES names", () => {
		for (const file of PLUGIN_AGENT_FILES) {
			assert.equal(GEN_PLUGIN_TRIGGER.test(`.claude/agents/${file}`), true);
		}
	});

	it("matches packages/cli/package.json", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("packages/cli/package.json"), true);
	});

	it("matches a hooks/ path", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("hooks/retro-reminder-post-tool-use.mjs"), true);
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
