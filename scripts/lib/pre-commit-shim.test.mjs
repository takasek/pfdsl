import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

const shim = readFileSync(new URL("../hooks/pre-commit-shim", import.meta.url));
const fixtures = [];

function fixture(defaultBranch = "main", gateExit = 0) {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-protected-shim-"));
	fixtures.push(root);
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: join(root, "global-config"),
		GIT_CONFIG_SYSTEM: join(root, "system-config"),
		GIT_AUTHOR_NAME: "Fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.invalid",
		GIT_COMMITTER_NAME: "Fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.invalid",
	};
	for (const name of [
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_COMMON_DIR",
		"GIT_INDEX_FILE",
		"GIT_CONFIG_COUNT",
	])
		delete env[name];
	const runGit = (...args) =>
		spawnSync("/usr/bin/git", args, { cwd: root, env, encoding: "utf8" });
	const git = (...args) => {
		const result = runGit(...args);
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	git("init", "-q", `--initial-branch=${defaultBranch}`);
	git("commit", "--allow-empty", "-qm", "fixture");
	git("update-ref", `refs/remotes/origin/${defaultBranch}`, "HEAD");
	git(
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		`refs/remotes/origin/${defaultBranch}`,
	);
	mkdirSync(join(root, "scripts"));
	writeFileSync(
		join(root, "scripts/pre-commit"),
		`#!/bin/sh\nprintf gate > gate-ran\nexit ${gateExit}\n`,
		{ mode: 0o755 },
	);
	writeFileSync(join(root, ".git/hooks/pre-commit"), shim, { mode: 0o755 });
	return {
		root,
		env,
		git,
		runGit,
		gateRan: () => existsSync(join(root, "gate-ran")),
	};
}

afterEach(() => {
	for (const root of fixtures.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("protected pre-commit shim", () => {
	for (const defaultBranch of ["main", "trunk"]) {
		it(`rejects an actual commit on default branch ${defaultBranch}`, () => {
			const { git, runGit, gateRan } = fixture(defaultBranch);
			const before = git("rev-parse", "HEAD");
			const result = runGit("commit", "--allow-empty", "-qm", "blocked");
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /default branch.*refused/);
			assert.equal(git("rev-parse", "HEAD"), before);
			assert.equal(gateRan(), false);
		});
	}
	it("runs the checkout gate for an actual feature-branch commit", () => {
		const { git, gateRan } = fixture();
		git("switch", "-qc", "feature");
		const before = git("rev-parse", "HEAD");
		git("commit", "--allow-empty", "-qm", "allowed");
		assert.notEqual(git("rev-parse", "HEAD"), before);
		assert.equal(gateRan(), true);
	});
	it("propagates a failing checkout gate without creating a commit", () => {
		const { git, runGit, gateRan } = fixture("main", 23);
		git("switch", "-qc", "feature");
		const before = git("rev-parse", "HEAD");
		assert.notEqual(
			runGit("commit", "--allow-empty", "-qm", "blocked").status,
			0,
		);
		assert.equal(gateRan(), true);
		assert.equal(git("rev-parse", "HEAD"), before);
	});
	it("does not mistake main for the default when origin/HEAD names trunk", () => {
		const { git, gateRan } = fixture("trunk");
		git("switch", "-qc", "main");
		git("commit", "--allow-empty", "-qm", "allowed");
		assert.equal(gateRan(), true);
	});
	for (const branch of ["feature", "main"]) {
		it(`uses the known main default without origin/HEAD on ${branch}`, () => {
			const { git, runGit, gateRan } = fixture();
			if (branch === "feature") git("switch", "-qc", branch);
			git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
			const before = git("rev-parse", "HEAD");
			const result = runGit("commit", "--allow-empty", "-qm", "fallback");
			assert.equal(result.status === 0, branch === "feature", result.stderr);
			if (branch === "main")
				assert.match(result.stderr, /default branch 'main'/);
			assert.equal(gateRan(), branch === "feature");
			assert.equal(git("rev-parse", "HEAD") === before, branch === "main");
		});
	}
	it("propagates the gate failure without origin/HEAD", () => {
		const { git, runGit, gateRan } = fixture("main", 23);
		git("switch", "-qc", "feature");
		git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
		const before = git("rev-parse", "HEAD");
		assert.notEqual(
			runGit("commit", "--allow-empty", "-qm", "blocked").status,
			0,
		);
		assert.equal(gateRan(), true);
		assert.equal(git("rev-parse", "HEAD"), before);
	});
	it("uses the known default without any remote-tracking refs", () => {
		const { git, gateRan } = fixture();
		git("switch", "-qc", "feature");
		git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
		git("update-ref", "-d", "refs/remotes/origin/main");
		git("commit", "--allow-empty", "-qm", "allowed");
		assert.equal(gateRan(), true);
	});
	for (const refState of ["direct", "malformed", "dangling", "non-origin"]) {
		it(`fails closed when origin/HEAD is ${refState}`, () => {
			const { root, git, runGit, gateRan } = fixture();
			git("switch", "-qc", "feature");
			if (refState === "direct") {
				git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
				git("update-ref", "refs/remotes/origin/HEAD", "HEAD");
			}
			if (refState === "malformed")
				writeFileSync(join(root, ".git/refs/remotes/origin/HEAD"), "invalid\n");
			if (refState === "dangling")
				git("update-ref", "-d", "refs/remotes/origin/main");
			if (refState === "non-origin")
				git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/heads/main");
			const before = git("rev-parse", "HEAD");
			const result = runGit("commit", "--allow-empty", "-qm", "blocked");
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /origin\/HEAD|default branch protection/);
			assert.equal(git("rev-parse", "HEAD"), before);
			assert.equal(gateRan(), false);
		});
	}
	it("runs the gate on detached HEAD", () => {
		const { git, gateRan } = fixture();
		git("switch", "--detach", "-q");
		git("commit", "--allow-empty", "-qm", "allowed");
		assert.equal(gateRan(), true);
	});
	it("fails closed on a detached HEAD that does not resolve to a commit", () => {
		const { root, env, gateRan } = fixture();
		writeFileSync(join(root, ".git/HEAD"), `${"1".repeat(40)}\n`);
		for (const args of [[], ["--check-default-branch"]]) {
			const result = spawnSync(
				"/bin/sh",
				[join(root, ".git/hooks/pre-commit"), ...args],
				{ cwd: root, env, encoding: "utf8" },
			);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /HEAD.*commit|cannot resolve HEAD/);
		}
		assert.equal(gateRan(), false);
	});
	it("rejects an actual commit when HEAD names a remote-tracking ref", () => {
		const { git, runGit, gateRan } = fixture();
		const before = git("rev-parse", "refs/remotes/origin/main");
		git("symbolic-ref", "HEAD", "refs/remotes/origin/main");
		const result = runGit("commit", "--allow-empty", "-qm", "blocked");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /HEAD.*branch|invalid HEAD/);
		assert.equal(git("rev-parse", "refs/remotes/origin/main"), before);
		assert.equal(gateRan(), false);
	});
	it("fails closed without an executable checkout gate", () => {
		const { root, git, runGit } = fixture();
		git("switch", "-qc", "feature");
		rmSync(join(root, "scripts/pre-commit"));
		const result = runGit("commit", "--allow-empty", "-qm", "blocked");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /scripts\/pre-commit/);
	});
	it("checks default-branch protection without executing the gate", () => {
		const { root, env, git, gateRan } = fixture();
		const probe = () =>
			spawnSync(
				"/bin/sh",
				[join(root, ".git/hooks/pre-commit"), "--check-default-branch"],
				{ cwd: root, env, encoding: "utf8" },
			);
		assert.notEqual(probe().status, 0);
		git("switch", "-qc", "feature");
		assert.equal(probe().status, 0);
		assert.equal(gateRan(), false);
	});
});
