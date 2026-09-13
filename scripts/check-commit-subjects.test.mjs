/**
 * The CLI's process boundary: exit codes and argument wiring.
 *
 * The shared checker has its own tests, but they call the function. CI judges
 * this script by its exit code alone, so a missing `process.exit(1)` would
 * print a FAIL line and still report success — every function-level test would
 * stay green while the check stopped blocking anything (#1174).
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { makeGitRepository } from "./lib/git-test-repository.test-helper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "check-commit-subjects.mjs");

/** Commit with an exact subject, identity supplied per command. */
function commit(root, subject) {
	const args = [
		"-c",
		"user.name=test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--allow-empty",
		"--allow-empty-message",
		"-m",
		subject,
	];
	execFileSync("git", args, { cwd: root });
	return execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf-8",
	}).trim();
}

/** @returns {{status: number, stdout: string, stderr: string}} */
function runCli(cwd, args) {
	const r = spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf-8",
	});
	return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe("check-commit-subjects CLI", () => {
	/** @type {string} */
	let root;
	/** @type {string} */
	let base;

	before(() => {
		root = makeGitRepository({ prefix: "check-commit-subjects-" });
		base = commit(root, "chore: base");
	});

	after(() => rmSync(root, { recursive: true, force: true }));

	it("exits 0 on a range whose subjects all pass", () => {
		const head = commit(root, "feat(cli): add a thing");
		const r = runCli(root, ["--base", base, "--head", head]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /PASS/);
	});

	it("exits 1 on a non-Conventional subject", () => {
		const from = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf-8",
		}).trim();
		const head = commit(root, "add a thing");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stdout, /FAIL/);
		assert.match(r.stdout, /add a thing/);
	});

	it("exits 1 on a commit with an empty subject", () => {
		const from = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf-8",
		}).trim();
		const head = commit(root, "");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
	});

	it("exits 1 when the range cannot be read", () => {
		const r = runCli(root, ["--base", "origin/does-not-exist"]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
	});

	it("exits 0 and reports SKIP on an empty range", () => {
		const head = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf-8",
		}).trim();
		const r = runCli(root, ["--base", head, "--head", head]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /SKIP/);
	});

	it("exits 2 on an unknown flag rather than falling back to a default range", () => {
		const r = runCli(root, ["--nope"]);
		assert.equal(r.status, 2, r.stdout + r.stderr);
	});

	it("exits 2 when --base is missing", () => {
		const r = runCli(root, []);
		assert.equal(r.status, 2, r.stdout + r.stderr);
	});
});
