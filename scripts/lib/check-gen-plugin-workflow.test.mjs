import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { GEN_INSTALL_OUTPUT } from "./gen-plugin-outputs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function workflowSteps(path, job) {
	return parse(readFileSync(resolve(root, path), "utf8")).jobs[job].steps;
}

describe("check-gen-plugin workflow", () => {
	it("diffs the CI share of the gen-plugin output contract after regenerating", () => {
		const step = workflowSteps(
			".github/workflows/check-gen-plugin.yml",
			"gen-plugin",
		).find((candidate) => candidate.run?.includes("make gen-plugin"));
		assert.ok(step, "expected the generated-output identity step");

		const lines = step.run.split("\n").map((line) => line.trim());
		const regenerate = lines.indexOf("make gen-plugin");
		const check = lines.indexOf(
			"if ! node scripts/check-generated-drift.mjs --gen-plugin ci; then",
		);
		assert.ok(regenerate >= 0, "expected make gen-plugin on its own line");
		assert.ok(check > regenerate, "expected the contract diff after it");
		assert.ok(
			!/check-generated-drift\.mjs -- /.test(step.run),
			"the CI step must not spell its own pathspec list",
		);
	});

	it("runs check-docs once per CI event, in the required gen-plugin job", () => {
		const testJob = workflowSteps(".github/workflows/test.yml", "test");
		assert.deepEqual(
			testJob.filter((step) => step.run?.includes("check-docs")),
			[],
			"test.yml must not repeat the suite make gen-plugin runs",
		);

		const makefile = readFileSync(resolve(root, "Makefile"), "utf8");
		const rule = /^gen-plugin:([^\n]*)$/m.exec(makefile);
		assert.ok(rule, "Makefile declares gen-plugin");
		assert.ok(rule[1].trim().split(/\s+/).includes("check-docs"));

		// A check-docs failure has to fail the job: the step keeps the default
		// errexit shell and nothing downstream of make swallows its status.
		const job = parse(
			readFileSync(
				resolve(root, ".github/workflows/check-gen-plugin.yml"),
				"utf8",
			),
		).jobs["gen-plugin"];
		const step = job.steps.find((s) => s.run?.includes("make gen-plugin"));
		assert.equal(job["continue-on-error"], undefined);
		assert.equal(step["continue-on-error"], undefined);
		assert.equal(step.shell, undefined);
		assert.doesNotMatch(step.run, /set \+e|make gen-plugin\s*(\|\||;)/);
	});

	it("checks untracked outputs in the install workflow", () => {
		const cases = [
			[".github/workflows/check-pfd-ops-sync.yml", [GEN_INSTALL_OUTPUT]],
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
