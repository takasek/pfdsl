import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let fixture;

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), "check-review-record-"));
	cpSync(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
	git(["init", "--bare", "remote.git"], fixture);
	git(["init", "--initial-branch=main"], fixture);
	git(["config", "user.email", "test@example.com"], fixture);
	git(["config", "user.name", "Test User"], fixture);
	git(["commit", "--allow-empty", "-m", "test: establish main"], fixture);
	git(["remote", "add", "origin", join(fixture, "remote.git")], fixture);
	git(["push", "origin", "HEAD:main"], fixture);
	git(["fetch", "origin", "main"], fixture);
});

afterEach(() => {
	rmSync(fixture, { recursive: true, force: true });
});

function git(args, cwd) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
}

describe("check-review-record", () => {
	it("runs without package dependencies", () => {
		const result = spawnSync(
			process.execPath,
			[join(fixture, "scripts/check-review-record.mjs")],
			{ cwd: fixture, encoding: "utf8" },
		);

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /check-review-record: PASS/);
	});
});
