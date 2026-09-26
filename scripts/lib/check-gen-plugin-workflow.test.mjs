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
