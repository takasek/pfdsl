import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function run(policy) {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-1411-local-entry-"));
	try {
		mkdirSync(join(root, "scripts/hooks"), { recursive: true });
		copyFileSync(
			new URL("../pre-commit-entry", import.meta.url),
			join(root, "scripts/pre-commit-entry"),
		);
		if (policy)
			writeFileSync(join(root, "scripts/hooks/pre-commit-shim"), policy, {
				mode: 0o755,
			});
		return spawnSync("sh", ["scripts/pre-commit-entry"], {
			cwd: root,
			encoding: "utf8",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("local entry refuses a checkout without its protected policy", () => {
	const result = run(null);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /missing or not executable/);
});

test("local entry propagates the checkout policy rejection", () => {
	const result = run("#!/bin/sh\necho 'policy rejection' >&2\nexit 23\n");
	assert.equal(result.status, 23);
	assert.match(result.stderr, /policy rejection/);
});

test("local entry delegates successful policy and gates to the checkout", () => {
	const result = run("#!/bin/sh\necho 'checkout gates completed'\nexit 0\n");
	assert.equal(result.status, 0);
	assert.equal(result.stdout.trim(), "checkout gates completed");
});
