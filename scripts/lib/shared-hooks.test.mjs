import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { parse } from "yaml";

const roots = [];
const sourceRoot = new URL("../../", import.meta.url);
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-1403-"));
	roots.push(root);
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: join(root, "global"),
		GIT_CONFIG_SYSTEM: join(root, "system"),
	};
	for (const name of Object.keys(env))
		if (
			name.startsWith("GIT_") &&
			!["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"].includes(name)
		)
			delete env[name];
	const git = (...args) =>
		spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
	assert.equal(git("init", "-qb", "feature").status, 0);
	assert.equal(
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"initial",
		).status,
		0,
	);
	assert.equal(git("update-ref", "refs/remotes/origin/main", "HEAD").status, 0);
	assert.equal(
		git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
			.status,
		0,
	);
	mkdirSync(join(root, "scripts/hooks"), { recursive: true });
	copyFileSync(
		new URL("scripts/hooks/pre-commit-shim", sourceRoot),
		join(root, "scripts/hooks/pre-commit-shim"),
	);
	writeFileSync(
		join(root, "scripts/pre-commit"),
		"#!/bin/sh\necho gate-ran\n",
		{ mode: 0o755 },
	);
	const hook = join(root, ".git/hooks/pre-commit");
	return { root, env, git, hook };
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("actual Git pre-commit refuses default branch and missing origin/HEAD before checkout gates", () => {
	const { root, git, hook } = fixture();
	copyFileSync(join(root, "scripts/hooks/pre-commit-shim"), hook);
	chmodSync(hook, 0o755);
	const commit = () =>
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"probe",
		);
	assert.equal(commit().status, 0);
	assert.equal(git("switch", "-c", "main").status, 0);
	const before = git("rev-parse", "HEAD").stdout;
	const refused = commit();
	assert.notEqual(refused.status, 0);
	assert.match(refused.stderr, /default branch/);
	assert.doesNotMatch(refused.stdout, /gate-ran/);
	assert.equal(git("rev-parse", "HEAD").stdout, before);
	assert.equal(git("switch", "feature").status, 0);
	assert.equal(
		git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD").status,
		0,
	);
	assert.notEqual(commit().status, 0);
});

test("installer repairs legacy shim, preserves compatible newer versions and refuses custom hooks", async () => {
	const { ensureSharedHook, LEGACY_SHIM } = await import("../shared-hooks.mjs");
	const { root, env, hook, git } = fixture();
	writeFileSync(hook, LEGACY_SHIM, { mode: 0o755 });
	await ensureSharedHook(root, { env });
	const current = readFileSync(hook, "utf8");
	assert.match(current, /pfdsl-pre-commit-shim-version: 1/);
	const newer = current.replace("shim-version: 1", "shim-version: 2");
	writeFileSync(hook, newer, { mode: 0o755 });
	await ensureSharedHook(root, { env });
	assert.equal(readFileSync(hook, "utf8"), newer);
	git("config", "core.hooksPath", "custom-hooks");
	await assert.rejects(ensureSharedHook(root, { env }), /custom|hooksPath/);
	assert.equal(readFileSync(hook, "utf8"), newer);
});

test("parallel installers serialize version comparisons and leave executable complete shim", async () => {
	await import("../shared-hooks.mjs");
	const { root, env, hook, git } = fixture();
	const linked = join(root, "linked");
	assert.equal(git("worktree", "add", "-b", "other", linked).status, 0);
	mkdirSync(join(linked, "scripts/hooks"), { recursive: true });
	const old = readFileSync(join(root, "scripts/hooks/pre-commit-shim"), "utf8");
	writeFileSync(
		join(linked, "scripts/hooks/pre-commit-shim"),
		old.replace("shim-version: 1", "shim-version: 2"),
	);
	const script = new URL("scripts/shared-hooks.mjs", sourceRoot).pathname;
	const run = (cwd) =>
		new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [script, "install"], {
				cwd,
				env,
				stdio: ["ignore", "ignore", "pipe"],
			});
			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.on("error", reject);
			child.on("close", (code) =>
				code === 0 ? resolve() : reject(new Error(stderr)),
			);
		});
	for (let i = 0; i < 3; i++)
		await Promise.all([run(root), run(linked), run(root), run(linked)]);
	assert.equal(
		readFileSync(hook, "utf8"),
		old.replace("shim-version: 1", "shim-version: 2"),
	);
	assert.ok(statSync(hook).mode & 0o111);
	assert.equal(existsSync(`${hook}.pfdsl-lock`), false);
	assert.equal(
		readdirSync(join(root, ".git/hooks")).some((name) => name.endsWith(".tmp")),
		false,
	);
});

test("new checkout pre-commit repairs a historical downgrade before default branch refusal", async () => {
	const { LEGACY_SHIM } = await import("../shared-hooks.mjs");
	const { root, hook, git } = fixture();
	for (const path of ["scripts/pre-commit", "scripts/shared-hooks.mjs"])
		copyFileSync(new URL(path, sourceRoot), join(root, path));
	mkdirSync(join(root, "scripts/lib"));
	copyFileSync(
		new URL("scripts/lib/cli-entrypoint.mjs", sourceRoot),
		join(root, "scripts/lib/cli-entrypoint.mjs"),
	);
	chmodSync(join(root, "scripts/pre-commit"), 0o755);
	chmodSync(join(root, "scripts/hooks/pre-commit-shim"), 0o755);
	writeFileSync(hook, LEGACY_SHIM, { mode: 0o755 });
	assert.equal(git("switch", "-c", "main").status, 0);
	const before = git("rev-parse", "HEAD").stdout;
	const result = git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"--allow-empty",
		"-qm",
		"probe",
	);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /default branch/);
	assert.equal(git("rev-parse", "HEAD").stdout, before);
	assert.match(readFileSync(hook, "utf8"), /shim-version: 1/);
});

test("refuses unknown or incompatible newer hooks and bounds shared lock waiting", async () => {
	const { ensureSharedHook } = await import("../shared-hooks.mjs");
	const { root, env, hook } = fixture();
	for (const content of [
		"#!/bin/sh\nexit 0\n",
		"#!/bin/sh\n# pfdsl-pre-commit-shim-version: 9\nexit 0\n",
	]) {
		writeFileSync(hook, content, { mode: 0o755 });
		await assert.rejects(
			ensureSharedHook(root, { env }),
			/refusing to overwrite/,
		);
		assert.equal(readFileSync(hook, "utf8"), content);
	}
	mkdirSync(`${hook}.pfdsl-lock`);
	await assert.rejects(ensureSharedHook(root, { env, waitMs: 1 }), /Timed out/);
	assert.equal(existsSync(`${hook}.pfdsl-lock`), true);
});

for (const name of ["trunk", "release/2026"])
	test(`shared shim refuses the actual default branch ${name}`, () => {
		const { root, hook, git } = fixture();
		copyFileSync(join(root, "scripts/hooks/pre-commit-shim"), hook);
		chmodSync(hook, 0o755);
		git("update-ref", `refs/remotes/origin/${name}`, "HEAD");
		git(
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
			`refs/remotes/origin/${name}`,
		);
		git("switch", "-c", name);
		const result = git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"probe",
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /default branch/);
	});

test("default-branch linked checkout commit leaves HEAD and staged index unchanged", () => {
	const { root, hook, git } = fixture();
	copyFileSync(join(root, "scripts/hooks/pre-commit-shim"), hook);
	chmodSync(hook, 0o755);
	const linked = join(root, "linked");
	assert.equal(git("worktree", "add", "-b", "main", linked).status, 0);
	writeFileSync(join(linked, "probe.txt"), "keep this staged\n");
	assert.equal(git("-C", linked, "add", "probe.txt").status, 0);
	const beforeHead = git("-C", linked, "rev-parse", "HEAD").stdout;
	const beforeIndex = git("-C", linked, "ls-files", "--stage", "-z").stdout;
	const result = git(
		"-C",
		linked,
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-qm",
		"probe",
	);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /default branch/);
	assert.equal(git("-C", linked, "rev-parse", "HEAD").stdout, beforeHead);
	assert.equal(
		git("-C", linked, "ls-files", "--stage", "-z").stdout,
		beforeIndex,
	);
});

test("Dependabot workflow prepares origin/HEAD before setup and real batch-branch commits", () => {
	const { root, hook, env, git } = fixture();
	const workflow = parse(
		readFileSync(
			new URL(".github/workflows/dependabot-actions-integrate.yml", sourceRoot),
			"utf8",
		),
	);
	const steps = workflow.jobs.integrate.steps;
	const prepareAt = steps.findIndex(
		(step) => step.name === "Resolve the remote default branch",
	);
	assert.ok(
		prepareAt >= 0 &&
			prepareAt < steps.findIndex((step) => step.run === "make setup"),
	);
	assert.equal(git("branch", "main").status, 0);
	const origin = join(root, "origin.git");
	assert.equal(git("clone", "--bare", root, origin).status, 0);
	assert.equal(
		git("--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main").status,
		0,
	);
	assert.equal(git("remote", "add", "origin", origin).status, 0);
	assert.equal(
		git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD").status,
		0,
	);
	copyFileSync(join(root, "scripts/hooks/pre-commit-shim"), hook);
	chmodSync(hook, 0o755);
	const commit = () =>
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"batch repair",
		);
	assert.notEqual(commit().status, 0);
	const prepared = spawnSync("/bin/sh", ["-c", steps[prepareAt].run], {
		cwd: root,
		env,
		encoding: "utf8",
	});
	assert.equal(prepared.status, 0, prepared.stderr);
	assert.equal(
		git("symbolic-ref", "refs/remotes/origin/HEAD").stdout.trim(),
		"refs/remotes/origin/main",
	);
	assert.equal(commit().status, 0);
});
