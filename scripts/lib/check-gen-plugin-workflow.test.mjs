import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { buildGates } from "./drift-gates.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("check-gen-plugin workflow", () => {
	it("rejects drift in every generated output guarded by pre-commit", () => {
		const workflow = parse(
			readFileSync(
				resolve(root, ".github/workflows/check-gen-plugin.yml"),
				"utf8",
			),
		);
		const step = workflow.jobs["gen-plugin"].steps.find((candidate) =>
			candidate.run?.includes("make gen-plugin"),
		);
		assert.ok(step, "expected the generated-output identity step");

		const checkCommand = step.run
			.split("\n")
			.map((line) => line.trim())
			.find((line) =>
				line.startsWith("if ! node scripts/check-generated-drift.mjs -- "),
			);
		assert.ok(checkCommand, "expected a generated drift assertion");
		const pathspecs = checkCommand
			.replace(/^if ! node scripts\/check-generated-drift\.mjs -- /, "")
			.replace(/; then$/, "")
			.split(/\s+/);

		const preCommitGate = buildGates({ stagedPresent: [] }).find(
			(gate) => gate.id === "gen-plugin-bulk",
		);
		assert.ok(preCommitGate, "expected the pre-commit generated-output gate");
		const [node, args] = preCommitGate.commands.at(-1);
		assert.equal(node, "node");
		assert.deepEqual(args.slice(0, 2), [
			"scripts/check-generated-drift.mjs",
			"--",
		]);
		const skillMdExclusion = ":(exclude)generated/skills/pfdsl/SKILL.md";
		const preCommitPathspecs = args
			.slice(2)
			.filter((pathspec) => pathspec !== skillMdExclusion);

		// Pre-commit checks SKILL.md in its separate dist-dependent gate. CI runs
		// the complete generator after building dist, so its broad `generated`
		// pathspec intentionally covers SKILL.md instead of excluding it.
		assert.deepEqual(pathspecs, preCommitPathspecs);
	});

	it("checks untracked outputs in the install and snapshot workflows", () => {
		const cases = [
			[
				".github/workflows/check-pfd-ops-sync.yml",
				[".claude/skills/pfd-ops/install"],
			],
			[".github/workflows/test.yml", ["packages/core/src/__snapshots__/"]],
		];

		for (const [workflowPath, expectedPaths] of cases) {
			const source = readFileSync(resolve(root, workflowPath), "utf8");
			const command = source
				.split("\n")
				.map((line) => line.trim())
				.find((line) =>
					line.includes("node scripts/check-generated-drift.mjs --"),
				);
			assert.ok(command, `${workflowPath} must use the shared drift check`);
			assert.deepEqual(
				command
					.replace(/^.*node scripts\/check-generated-drift\.mjs -- /, "")
					.replace(/; then$/, "")
					.split(/\s+/),
				expectedPaths,
			);
		}
	});
});
