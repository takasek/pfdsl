import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	AGENT_EXCLUSIONS,
	CLAUDE_PLUGIN_MIRRORS,
	COMMAND_EXCLUSIONS,
	DISTRIBUTED_AGENTS,
	DISTRIBUTED_COMMANDS,
	DISTRIBUTED_SKILLS,
	GENERATED_COMMANDS,
	GENERATED_SKILLS,
	SKILL_EXCLUSIONS,
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

	it("accounts for every skill, command, and agent source entry", () => {
		const kinds = [
			{
				name: "skill",
				onDisk: readdirSync(resolve(root, ".claude/skills")).sort(),
				distributed: DISTRIBUTED_SKILLS,
				exclusions: SKILL_EXCLUSIONS,
				generated: GENERATED_SKILLS,
			},
			{
				name: "command",
				onDisk: readdirSync(resolve(root, ".claude/commands"))
					.filter((file) => file.endsWith(".md"))
					.sort(),
				distributed: DISTRIBUTED_COMMANDS,
				exclusions: COMMAND_EXCLUSIONS,
				generated: GENERATED_COMMANDS,
			},
			{
				name: "agent",
				onDisk: readdirSync(resolve(root, ".claude/agents"))
					.filter((file) => file.endsWith(".md"))
					.sort(),
				distributed: DISTRIBUTED_AGENTS,
				exclusions: AGENT_EXCLUSIONS,
				generated: {},
			},
		];

		for (const { name, onDisk, distributed, exclusions, generated } of kinds) {
			const accounted = [
				...distributed,
				...Object.keys(exclusions),
				...Object.keys(generated),
			].sort();
			assert.deepEqual(accounted, onDisk, `${name} inventory`);
			assert.equal(
				new Set(accounted).size,
				accounted.length,
				`${name} inventory has no duplicate classifications`,
			);
			for (const file of distributed) {
				assert.ok(onDisk.includes(file), `${file} is distributed but missing`);
			}
			for (const [file, reason] of Object.entries(exclusions)) {
				assert.ok(
					reason.trim().length > 0,
					`${file} is excluded without a reason`,
				);
			}
			for (const [file, classification] of Object.entries(generated)) {
				assert.ok(
					classification.reason.trim().length > 0,
					`${file} is generated without a reason`,
				);
			}
		}
	});

	it("classifies the generated pfdsl source outside the distributed collision set", () => {
		assert.deepEqual(GENERATED_SKILLS.pfdsl, {
			reason: "generated symlink to the rendered plugin skill tree",
			source: ".claude/skills/pfdsl",
			target: "plugin/pfdsl/skills/pfdsl",
		});
		assert.equal(DISTRIBUTED_SKILLS.includes("pfdsl"), false);
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
		assert.equal(Object.isFrozen(SKILL_EXCLUSIONS), true);
		assert.equal(Object.isFrozen(COMMAND_EXCLUSIONS), true);
		assert.equal(Object.isFrozen(GENERATED_SKILLS), true);
		assert.equal(Object.isFrozen(GENERATED_COMMANDS), true);
		assert.equal(Object.isFrozen(CLAUDE_PLUGIN_MIRRORS), true);
	});
});
