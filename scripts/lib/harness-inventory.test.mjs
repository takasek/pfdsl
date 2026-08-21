import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	AGENT_EXCLUSIONS,
	CLAUDE_PLUGIN_MIRRORS,
	DISTRIBUTED_AGENTS,
	DISTRIBUTED_COMMANDS,
	DISTRIBUTED_SKILLS,
} from "./harness-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("harness distribution inventory", () => {
	it("lists the maintained skills exactly", () => {
		assert.deepEqual(DISTRIBUTED_SKILLS, [
			"pfd-grill",
			"pfd-ops",
			"pfd-retro",
			"pfd-ecosystem",
		]);
	});

	it("lists the maintained commands exactly", () => {
		assert.deepEqual(DISTRIBUTED_COMMANDS, [
			"pfd-cycle.md",
			"pfd-init.md",
			"pfd-retro.md",
		]);
	});

	it("lists the maintained agents exactly", () => {
		assert.deepEqual(DISTRIBUTED_AGENTS, ["pfd-lens.md", "pfd-implementer.md"]);
	});

	it("accounts for every agent source file", () => {
		const onDisk = readdirSync(resolve(root, ".claude/agents"))
			.filter((file) => file.endsWith(".md"))
			.sort();
		const accounted = [
			...DISTRIBUTED_AGENTS,
			...Object.keys(AGENT_EXCLUSIONS),
		].sort();

		assert.deepEqual(accounted, onDisk);
		for (const file of DISTRIBUTED_AGENTS) {
			assert.ok(onDisk.includes(file), `${file} is distributed but missing`);
		}
		for (const [file, reason] of Object.entries(AGENT_EXCLUSIONS)) {
			assert.ok(
				reason.trim().length > 0,
				`${file} is excluded without a reason`,
			);
		}
	});

	it("describes the Claude plugin mirrors from the inventory", () => {
		assert.deepEqual(CLAUDE_PLUGIN_MIRRORS, [
			{ dest: "skills", src: ".claude/skills", trees: DISTRIBUTED_SKILLS },
			{
				dest: "commands",
				src: ".claude/commands",
				files: DISTRIBUTED_COMMANDS,
			},
			{ dest: "agents", src: ".claude/agents", files: DISTRIBUTED_AGENTS },
			{ dest: "hooks", src: "hooks", whole: true },
		]);
	});

	it("freezes inventory collections", () => {
		assert.equal(Object.isFrozen(DISTRIBUTED_SKILLS), true);
		assert.equal(Object.isFrozen(DISTRIBUTED_COMMANDS), true);
		assert.equal(Object.isFrozen(DISTRIBUTED_AGENTS), true);
		assert.equal(Object.isFrozen(AGENT_EXCLUSIONS), true);
		assert.equal(Object.isFrozen(CLAUDE_PLUGIN_MIRRORS), true);
	});
});
