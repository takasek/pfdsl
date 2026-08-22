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

		const diffCommand = step.run
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line.startsWith("if ! git diff --exit-code "));
		assert.ok(diffCommand, "expected a git diff identity assertion");
		const pathspecs = diffCommand
			.replace(/^if ! git diff --exit-code /, "")
			.replace(/; then$/, "")
			.split(/\s+/);

		const preCommitGate = buildGates({ stagedPresent: [] }).find(
			(gate) => gate.id === "gen-plugin-bulk",
		);
		assert.ok(preCommitGate, "expected the pre-commit generated-output gate");
		const [git, args] = preCommitGate.commands.at(-1);
		assert.equal(git, "git");
		assert.deepEqual(args.slice(0, 3), ["diff", "--quiet", "--"]);
		const skillMdExclusion = ":(exclude)plugin/pfdsl/skills/pfdsl/SKILL.md";
		const preCommitPathspecs = args
			.slice(3)
			.filter((pathspec) => pathspec !== skillMdExclusion);

		// Pre-commit checks SKILL.md in its separate dist-dependent gate. CI runs
		// the complete generator after building dist, so its broad `plugin`
		// pathspec intentionally covers SKILL.md instead of excluding it.
		assert.deepEqual(pathspecs, preCommitPathspecs);
	});
});
