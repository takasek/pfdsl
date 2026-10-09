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

test("legacy adapter refuses a checkout without an executable shim", () => {
	const result = run(null);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /missing or not executable/);
});

test("legacy adapter propagates the delegated shim's exit status", () => {
	const result = run("#!/bin/sh\necho 'policy rejection' >&2\nexit 23\n");
	assert.equal(result.status, 23);
	assert.match(result.stderr, /policy rejection/);
});

test("legacy adapter delegates once to the checkout shim", () => {
	const result = run("#!/bin/sh\necho 'checkout gates completed'\nexit 0\n");
	assert.equal(result.status, 0);
	assert.equal(result.stdout.trim(), "checkout gates completed");
});

test("legacy adapter reaches the actual HEAD guard and runs checkout gates once", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-legacy-entry-"));
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: join(root, "global"),
		GIT_CONFIG_SYSTEM: join(root, "system"),
	};
	for (const key of Object.keys(env))
		if (
			key.startsWith("GIT_") &&
			!["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"].includes(key)
		)
			delete env[key];
	const git = (...args) =>
		spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
	try {
		mkdirSync(join(root, "scripts/hooks"), { recursive: true });
		mkdirSync(join(root, "scripts/lib"));
		for (const path of [
			"scripts/pre-commit-entry",
			"scripts/hooks/pre-commit-shim",
			"scripts/hooks/check-default-branch",
			"scripts/pre-commit",
		])
			copyFileSync(new URL(`../../${path}`, import.meta.url), join(root, path));
		writeFileSync(
			join(root, "scripts/check-drift-gates.mjs"),
			"console.log('checkout-gate'); process.exit(Number(process.env.TEST_GATE_EXIT ?? 0));\n",
		);
		writeFileSync(join(root, "scripts/lib/retro-reminder-check.mjs"), "");
		assert.equal(git("init", "-qb", "feature").status, 0);
		assert.equal(git("add", "scripts").status, 0);
		assert.equal(
			git(
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"commit",
				"-qm",
				"initial guard",
			).status,
			0,
		);
		assert.equal(
			git("update-ref", "refs/remotes/origin/main", "HEAD").status,
			0,
		);
		assert.equal(
			git(
				"symbolic-ref",
				"refs/remotes/origin/HEAD",
				"refs/remotes/origin/main",
			).status,
			0,
		);
		const invoke = (extra = {}) =>
			spawnSync("sh", ["scripts/pre-commit-entry"], {
				cwd: root,
				env: { ...env, ...extra },
				encoding: "utf8",
			});
		const success = invoke();
		assert.equal(success.status, 0, success.stderr);
		assert.equal(success.stdout.trim(), "checkout-gate");
		const rejectedGate = invoke({ TEST_GATE_EXIT: "23" });
		assert.equal(rejectedGate.status, 1, rejectedGate.stderr);
		assert.equal(rejectedGate.stdout.trim(), "checkout-gate");
		assert.equal(git("checkout", "-qb", "main").status, 0);
		const rejectedBranch = invoke();
		assert.equal(rejectedBranch.status, 1);
		assert.match(rejectedBranch.stderr, /default branch 'main'/);
		assert.equal(
			rejectedBranch.stdout,
			"",
			"default branch must stop before gates",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
