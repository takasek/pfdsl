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
	HARNESS_CAPABILITY_CONTRACT,
	SKILL_EXCLUSIONS,
} from "./harness-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("harness distribution inventory", () => {
	it("declares every current capability family with a stable unique ID", () => {
		const expectedIds = [
			"skill:pfd-grill",
			"skill:pfd-ops",
			"skill:pfd-retro",
			"skill:pfd-ecosystem",
			"skill:pfd-upstream-report",
			"skill:pfdsl",
			"command:pfd-cycle",
			"command:pfd-init",
			"command:pfd-retro",
			"agent:pfd-lens",
			"agent:pfd-implementer",
			"repository-instructions",
			"repository-hooks",
			"plugin-hooks",
			"plugin-metadata",
		];
		const actualIds = HARNESS_CAPABILITY_CONTRACT.map(({ id }) => id);

		assert.deepEqual(actualIds, expectedIds);
		assert.equal(new Set(actualIds).size, actualIds.length);
	});

	it("declares all four target mappings without target defaults", () => {
		const targets = [
			"claude-repository",
			"claude-plugin",
			"codex-repository",
			"codex-plugin",
		];

		for (const capability of HARNESS_CAPABILITY_CONTRACT) {
			assert.deepEqual(
				capability.mappings.map(({ target }) => target),
				targets,
				capability.id,
			);
		}
	});

	it("keeps command and agent target dispositions explicit", () => {
		const dispositionsFor = (id) =>
			HARNESS_CAPABILITY_CONTRACT.find(
				(capability) => capability.id === id,
			).mappings.map(({ disposition }) => disposition);

		for (const id of [
			"command:pfd-cycle",
			"command:pfd-init",
			"command:pfd-retro",
		]) {
			assert.deepEqual(dispositionsFor(id), [
				"native",
				"native",
				"transform",
				"transform",
			]);
		}
		for (const id of ["agent:pfd-lens", "agent:pfd-implementer"]) {
			assert.deepEqual(dispositionsFor(id), [
				"native",
				"native",
				"transform",
				"intentional-exclusion",
			]);
		}
	});

	it("keeps declared source paths and target output surfaces unique", () => {
		const sourcePaths = HARNESS_CAPABILITY_CONTRACT.map(
			({ source }) => source.path,
		);
		assert.equal(new Set(sourcePaths).size, sourcePaths.length);

		for (const target of [
			"claude-repository",
			"claude-plugin",
			"codex-repository",
			"codex-plugin",
		]) {
			const outputs = HARNESS_CAPABILITY_CONTRACT.flatMap((capability) =>
				capability.mappings
					.filter((mapping) => mapping.target === target)
					.flatMap((mapping) => mapping.outputs ?? []),
			);
			assert.equal(
				new Set(outputs).size,
				outputs.length,
				`${target} output surfaces`,
			);
		}
	});

	it("freezes the contract declaration and its mappings", () => {
		assert.equal(Object.isFrozen(HARNESS_CAPABILITY_CONTRACT), true);
		for (const capability of HARNESS_CAPABILITY_CONTRACT) {
			assert.equal(Object.isFrozen(capability), true, capability.id);
			assert.equal(Object.isFrozen(capability.source), true, capability.id);
			assert.equal(Object.isFrozen(capability.mappings), true, capability.id);
			for (const mapping of capability.mappings) {
				assert.equal(Object.isFrozen(mapping), true, capability.id);
			}
		}
	});

	it("lists the maintained skills exactly", () => {
		assert.deepEqual(DISTRIBUTED_SKILLS, [
			"pfd-grill",
			"pfd-ops",
			"pfd-retro",
			"pfd-ecosystem",
			"pfd-upstream-report",
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
			reason: "generated symlink to the neutral rendered skill tree",
			source: ".claude/skills/pfdsl",
			target: "generated/skills/pfdsl",
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
