import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("issue-close flow workflow", () => {
	it("runs the targeted registration check before the fix step and blocks on failure", () => {
		const workflow = parse(
			readFileSync(
				resolve(root, ".github/workflows/pfdsl-flow-on-issue-close.yml"),
				"utf8",
			),
		);
		const steps = workflow.jobs["sync-flow"].steps;
		const targetedIndex = steps.findIndex((step) =>
			step.run?.includes("--check-closed-registration"),
		);
		const applyIndex = steps.findIndex((step) =>
			step.name?.includes("Apply flow sync"),
		);

		assert.notEqual(targetedIndex, -1, "targeted check step is required");
		assert.notEqual(applyIndex, -1, "flow sync step is required");
		assert.ok(targetedIndex < applyIndex);
		const targetedStep = steps[targetedIndex];
		assert.match(
			targetedStep.run,
			/--check-closed-registration\s+\$\{\{\s*github\.event\.issue\.number\s*\}\}/,
		);
		assert.notEqual(targetedStep["continue-on-error"], true);
	});
});
