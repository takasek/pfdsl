import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";

test("desktop pull requests run the native export test on macOS as a required step", () => {
	const workflow = YAML.parse(
		readFileSync(
			new URL("../../.github/workflows/desktop.yml", import.meta.url),
			"utf8",
		),
	);
	assert.ok(Object.hasOwn(workflow.on, "pull_request"));
	const job = workflow.jobs["macos-app"];
	assert.match(job["runs-on"], /^macos-/);
	assert.equal(job.if, undefined);
	assert.equal(job["continue-on-error"], undefined);

	const build = job.steps.findIndex((step) => step.run === "pnpm -r build");
	const nativeExport = job.steps.findIndex(
		(step) =>
			step.run?.trim() ===
			"node --test --test-reporter=tap packages/standalone/test/native-export.test.mjs",
	);
	assert.notEqual(build, -1, "the workspace packages must be built");
	assert.ok(
		nativeExport > build,
		"the native export test must run after the build",
	);
	const step = job.steps[nativeExport];
	assert.equal(step.if, undefined);
	assert.equal(step["continue-on-error"], undefined);
});
