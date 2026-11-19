import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const moduleUrl = new URL("./dependabot-actions-batch.mjs", import.meta.url)
	.href;

test("batch verification preserves failure output beyond Node's error preview", () => {
	const marker = "BATCH_TEST_FAILURE_AT_END";
	const child = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import { run } from ${JSON.stringify(moduleUrl)};
run(process.execPath, ["-e", ${JSON.stringify(`console.log("x".repeat(20_000)); console.log("${marker}"); process.exit(7);`)}]);`,
		],
		{ encoding: "utf8" },
	);
	assert.notEqual(child.status, 0);
	assert.ok(child.stdout.endsWith(`\n${marker}\n`), child.stderr);
});

test("batch commands can stream successful output and still capture API data", () => {
	const child = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import assert from "node:assert/strict";
import { run } from ${JSON.stringify(moduleUrl)};
assert.equal(run(process.execPath, ["-e", 'console.log("streamed")']), "");
assert.equal(run(process.execPath, ["-e", 'console.log("captured")'], { capture: true }), "captured");`,
		],
		{ encoding: "utf8" },
	);
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout, "streamed\n");
});
