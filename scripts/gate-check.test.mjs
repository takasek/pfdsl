import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fixture;

function git(args) {
	const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
}

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), "gate-check-record-recovery-"));
	cpSync(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
	// Isolate unrelated project-wide checks; the gate entrypoint, its steps,
	// commit lint and all git history queries run unchanged.
	writeFileSync(
		join(fixture, "scripts/pfdsl/audit-issues-flow.mjs"),
		"process.exit(0);\n",
	);
	writeFileSync(join(fixture, "Makefile"), "check-docs:\n\t@true\n");
	git(["init", "--bare", "remote.git"]);
	git(["init", "--initial-branch=main"]);
	git(["config", "user.email", "test@example.com"]);
	git(["config", "user.name", "Test User"]);
	git(["commit", "--allow-empty", "-m", "test: establish main"]);
	git(["remote", "add", "origin", join(fixture, "remote.git")]);
	git(["push", "origin", "HEAD:main"]);
	mkdirSync(join(fixture, "packages/example"), { recursive: true });
	writeFileSync(
		join(fixture, "packages/example/index.js"),
		"export const value = 1;\n",
	);
	git(["add", "packages/example/index.js"]);
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

function runGate() {
	return spawnSync(
		process.execPath,
		[join(fixture, "scripts/gate-check.mjs"), "--no-artifact"],
		{
			cwd: fixture,
			encoding: "utf8",
		},
	);
}

describe("gate-check record recovery", () => {
	for (const message of [
		"fix: correct value",
		"fix: correct value\n\nReview: tool=subagent",
	]) {
		it(`accepts code changes without requiring review trailers: ${JSON.stringify(message)}`, () => {
			git(["commit", "-m", message]);
			const result = runGate();
			assert.equal(result.status, 0, result.stdout + result.stderr);
			assert.doesNotMatch(result.stdout, /Review record|malformed record/);
			assert.match(result.stdout, /PASS commit subject lint/);
		});
	}

	it("still rejects an invalid commit subject", () => {
		git(["commit", "-m", "invalid subject"]);
		const result = runGate();
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /FAIL commit subject lint/);
	});
});
