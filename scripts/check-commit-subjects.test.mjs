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

/**
 * git with an identity supplied per command: a test machine need not have one
 * configured, and the throwaway repository's own config stays untouched.
 */
function git(root, args) {
	return execFileSync(
		"git",
		["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
		{ cwd: root, encoding: "utf-8" },
	);
}

function headSha(root) {
	return git(root, ["rev-parse", "HEAD"]).trim();
}

/** Commit with an exact subject. */
function commit(root, subject) {
	git(root, [
		"commit",
		"--allow-empty",
		"--allow-empty-message",
		"-m",
		subject,
	]);
	return headSha(root);
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
		const from = headSha(root);
		const head = commit(root, "add a thing");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stdout, /FAIL/);
		assert.match(r.stdout, /add a thing/);
	});

	it("exits 1 on a commit with an empty subject", () => {
		const from = headSha(root);
		const head = commit(root, "");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
	});

	it("exits 1 when the range cannot be read", () => {
		const r = runCli(root, ["--base", "origin/does-not-exist"]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
	});

	it("exits 0 and reports SKIP on an empty range", () => {
		const head = headSha(root);
		const r = runCli(root, ["--base", head, "--head", head]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /SKIP/);
	});

	it("FAILs on a subject reachable only through a merge's side parent", () => {
		// --no-merges drops the merge commit itself, which git wrote; it must
		// not drop what the merge brought in. A traversal-narrowing option such
		// as --first-parent would, and every argv assertion elsewhere is on the
		// options rather than on the commits that survive them.
		const from = headSha(root);
		git(root, ["checkout", "-q", "-b", "side"]);
		commit(root, "add a side thing");
		git(root, ["checkout", "-q", "-"]);
		git(root, ["merge", "--no-ff", "-m", "chore: merge side", "side"]);
		const r = runCli(root, ["--base", from, "--head", headSha(root)]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stdout, /add a side thing/);
	});

	it("exits 2 on an unknown flag even when the range is complete", () => {
		// A bare --nope would exit 2 through the missing-base branch too, so
		// dropping `strict: true` would leave that version of this test green
		// while a typo'd --head was silently ignored and the default HEAD
		// linted instead.
		const head = headSha(root);
		const r = runCli(root, ["--base", head, "--head", head, "--nope"]);
		assert.equal(r.status, 2, r.stdout + r.stderr);
		assert.match(r.stderr, /Unknown option/);
	});

	it("exits 2 on a misspelled --head rather than linting the default range", () => {
		const head = headSha(root);
		const r = runCli(root, ["--base", head, "--hed", head]);
		assert.equal(r.status, 2, r.stdout + r.stderr);
		assert.match(r.stderr, /Unknown option/);
	});

	it("exits 2 when --base is missing", () => {
		const r = runCli(root, []);
		assert.equal(r.status, 2, r.stdout + r.stderr);
	});
});
