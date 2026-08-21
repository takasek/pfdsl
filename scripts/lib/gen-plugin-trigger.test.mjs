import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { collectModuleClosure } from "./check-script-imports.mjs";
import { GEN_INSTALL_TRIGGER } from "./gen-install-trigger.mjs";
import { PLUGIN_AGENT_FILES } from "./gen-plugin.mjs";
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

	it("matches scripts/gen-plugin-dist-independent.mjs", () => {
		assert.equal(
			GEN_PLUGIN_TRIGGER.test("scripts/gen-plugin-dist-independent.mjs"),
			true,
		);
	});

	it("matches the Codex assembly sources and generated roots", () => {
		for (const path of [
			"CLAUDE.md",
			".claude/settings.json",
			"scripts/lib/harness-inventory.mjs",
			"scripts/lib/gen-codex-assets.mjs",
			"scripts/gen-codex-assets.mjs",
			"AGENTS.md",
			".agents/skills/pfd-ops/SKILL.md",
			".codex/agents/pfd-implementer.toml",
			".codex/hooks.json",
			"plugin/pfdsl/.codex-plugin/plugin.json",
		]) {
			assert.equal(GEN_PLUGIN_TRIGGER.test(path), true, path);
		}
	});

	it("matches a .claude/skills/pfd-ecosystem/ path", () => {
		assert.equal(
			GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-ecosystem/SKILL.md"),
			true,
		);
	});

	it("matches a .claude/skills/pfd-retro/ path", () => {
		assert.equal(
			GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-retro/SKILL.md"),
			true,
		);
	});

	it("matches a .claude/skills/pfd-grill/ path", () => {
		assert.equal(
			GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-grill/SKILL.md"),
			true,
		);
	});

	it("matches .claude/commands/pfd-cycle.md", () => {
		assert.equal(
			GEN_PLUGIN_TRIGGER.test(".claude/commands/pfd-cycle.md"),
			true,
		);
	});

	it("matches .claude/commands/pfd-init.md", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test(".claude/commands/pfd-init.md"), true);
	});

	it("matches .claude/commands/pfd-retro.md", () => {
		assert.equal(
			GEN_PLUGIN_TRIGGER.test(".claude/commands/pfd-retro.md"),
			true,
		);
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
		assert.equal(
			GEN_PLUGIN_TRIGGER.test("hooks/retro-reminder-post-tool-use.mjs"),
			true,
		);
	});

	it("does not match an unrelated root-level README.md", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("README.md"), false);
	});

	it("matches a .claude/skills/pfd-ops/ path", () => {
		assert.equal(
			GEN_PLUGIN_TRIGGER.test(".claude/skills/pfd-ops/SKILL.md"),
			true,
		);
	});

	it("does not match an unrelated root-level file", () => {
		assert.equal(GEN_PLUGIN_TRIGGER.test("packages/core/src/index.ts"), false);
	});

	it("matches a hand-edit of the generated side", () => {
		// gen-install-trigger covers its own generated side for the same reason:
		// an edit made there is about to be overwritten, and the drift check is
		// what says so (#666).
		assert.equal(
			GEN_PLUGIN_TRIGGER.test("plugin/pfdsl/skills/pfdsl/references/spec.md"),
			true,
		);
		assert.equal(
			GEN_PLUGIN_TRIGGER.test("plugin/pfdsl/.claude-plugin/plugin.json"),
			true,
		);
	});

	it("matches a hand-edit of .claude-plugin/marketplace.json", () => {
		// Its per-plugin description is generated too (#685), even though the
		// file lives outside plugin/pfdsl/ — same reasoning as the previous test.
		assert.equal(
			GEN_PLUGIN_TRIGGER.test(".claude-plugin/marketplace.json"),
			true,
		);
	});

	it("covers every module the dist-independent assembly imports", () => {
		// The hand-kept alternation above drifts from the code it is supposed to
		// track. Deriving the expectation from the real import closure makes a
		// new dependency fail here rather than ship a stale bundle (#666).
		const root = `${resolve(dirname(fileURLToPath(import.meta.url)), "../..")}/`;
		const closure = [
			...collectModuleClosure("scripts/gen-plugin-dist-independent.mjs"),
		].map((file) => (file.startsWith(root) ? file.slice(root.length) : file));
		assert.ok(closure.length > 0);
		for (const file of closure) {
			// gen-install's own inputs are guarded by GEN_INSTALL_TRIGGER, whose gate
			// is declared first and blocks until install/ is regenerated.
			const covered =
				GEN_PLUGIN_TRIGGER.test(file) || GEN_INSTALL_TRIGGER.test(file);
			assert.ok(covered, `${file} triggers no drift check`);
		}
	});
});
