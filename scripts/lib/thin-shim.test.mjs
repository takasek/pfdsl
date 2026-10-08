import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { inspectHooksPath } from "../setup-completion.mjs";
import { ensureSharedHook, LEGACY_SHIM } from "../shared-hooks.mjs";

const source = new URL("../../", import.meta.url);
const roots = [];
const localFiles = [
	"scripts/pre-commit",
	"scripts/pre-commit-entry",
	"scripts/hooks/check-default-branch",
	"scripts/shared-hooks.mjs",
	"scripts/setup-completion.mjs",
	"scripts/link-repo-skill.mjs",
	"scripts/lib/cli-entrypoint.mjs",
	"scripts/lib/repo-skill-link.mjs",
	"scripts/hooks/pre-commit-shim",
	"Makefile",
];
function checkout(root, label = "gate-new", revision) {
	for (const file of localFiles) {
		const input = new URL(file, source);
		if (!existsSync(input)) continue;
		mkdirSync(dirname(join(root, file)), { recursive: true });
		copyFileSync(input, join(root, file));
	}
	const gate = existsSync(join(root, "scripts/pre-commit-entry"))
		? "scripts/pre-commit-gates"
		: "scripts/pre-commit";
	writeFileSync(
		join(root, gate),
		`#!/bin/sh\necho ${label}\nexit \${GATE_EXIT:-0}\n`,
		{ mode: 0o755 },
	);
	if (revision) {
		const file = join(root, "scripts/hooks/pre-commit-shim");
		writeFileSync(
			file,
			readFileSync(file, "utf8").replace(
				/shim-version: [0-9]+/,
				`shim-version: ${revision}`,
			),
		);
	}
	mkdirSync(join(root, "generated/skills/pfdsl"), { recursive: true });
	writeFileSync(
		join(root, "generated/skills/pfdsl/SKILL.md"),
		"fixture skill\n",
	);
	writeFileSync(join(root, "package.json"), "{}\n");
	writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
	writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
}
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-1415-"));
	roots.push(root);
	const env = { ...process.env };
	for (const key of Object.keys(env))
		if (key.startsWith("GIT_")) delete env[key];
	env.GIT_CONFIG_GLOBAL = join(root, "global");
	env.GIT_CONFIG_SYSTEM = join(root, "system");
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
	checkout(root);
	const hook = join(root, ".git/hooks/pre-commit");
	copyFileSync(join(root, "scripts/hooks/pre-commit-shim"), hook);
	chmodSync(hook, 0o755);
	const commit = (cwd = root, extraEnv = {}) =>
		spawnSync(
			"git",
			[
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"commit",
				"--allow-empty",
				"-qm",
				"probe",
			],
			{ cwd, env: { ...env, ...extraEnv }, encoding: "utf8" },
		);
	return { root, env, git, hook, commit };
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("shared bootstrap refuses legacy checkout on feature and default branches before old gates", () => {
	const { root, git, commit } = fixture();
	rmSync(join(root, "scripts/pre-commit-entry"), { force: true });
	writeFileSync(
		join(root, "scripts/pre-commit"),
		"#!/bin/sh\necho unprotected-old-gate\n",
		{ mode: 0o755 },
	);
	for (const branch of ["feature", "main"]) {
		if (branch === "main") assert.equal(git("switch", "-c", branch).status, 0);
		writeFileSync(join(root, "staged.txt"), branch);
		assert.equal(git("add", "staged.txt").status, 0);
		const head = git("rev-parse", "HEAD").stdout;
		const index = git("ls-files", "--stage", "-z").stdout;
		const result = commit();
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(
			result.stderr,
			/pre-commit-entry.*missing|update this checkout/i,
		);
		assert.doesNotMatch(result.stdout, /unprotected-old-gate/);
		assert.equal(git("rev-parse", "HEAD").stdout, head);
		assert.equal(git("ls-files", "--stage", "-z").stdout, index);
	}
});

test("checkout entry uses its own guard even if shim receives the historical check-only option", () => {
	const { root, git, hook, env } = fixture();
	assert.equal(git("switch", "-c", "main").status, 0);
	const result = spawnSync(hook, ["--check-default-branch"], {
		cwd: root,
		env,
		encoding: "utf8",
	});
	assert.notEqual(result.status, 0);
	assert.doesNotMatch(result.stdout, /gate-new/);
});

for (const path of [
	"scripts/pre-commit-entry",
	"scripts/hooks/check-default-branch",
	"scripts/pre-commit-gates",
]) {
	test(`missing or non-executable ${path} fails both readiness and Git commit`, () => {
		const { root, commit, env } = fixture();
		const target = join(root, path);
		if (existsSync(target)) chmodSync(target, 0o644);
		assert.notEqual(inspectHooksPath(root, { env }).reason, null);
		assert.notEqual(commit().status, 0);
		rmSync(target, { force: true });
		assert.notEqual(inspectHooksPath(root, { env }).reason, null);
		const failed = commit();
		assert.notEqual(failed.status, 0);
		assert.doesNotMatch(failed.stdout, /gate-new/);
	});
}

for (const fault of [
	"missing-origin",
	"direct-origin",
	"dangling-origin",
	"blob-origin",
	"outside-origin",
	"invalid-named-head",
	"unborn-head",
	"broken-detached-head",
]) {
	test(`guard fails closed for ${fault}`, () => {
		const { root, git, env } = fixture();
		const oldHead = git("rev-parse", "HEAD").stdout.trim();
		if (fault === "missing-origin")
			git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
		if (fault === "direct-origin") {
			git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
			git("update-ref", "refs/remotes/origin/HEAD", oldHead);
		}
		if (fault === "dangling-origin")
			git(
				"symbolic-ref",
				"refs/remotes/origin/HEAD",
				"refs/remotes/origin/missing",
			);
		if (fault === "outside-origin")
			git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/heads/feature");
		if (fault === "blob-origin") {
			writeFileSync(join(root, "blob"), "blob");
			const blob = git("hash-object", "-w", "blob").stdout.trim();
			git("update-ref", "refs/remotes/origin/main", blob);
		}
		if (fault === "invalid-named-head")
			writeFileSync(join(root, ".git/HEAD"), "ref: refs/remotes/origin/main\n");
		if (fault === "unborn-head")
			git("symbolic-ref", "HEAD", "refs/heads/unborn");
		if (fault === "broken-detached-head")
			writeFileSync(join(root, ".git/HEAD"), `${"1".repeat(40)}\n`);
		const result = spawnSync(join(root, ".git/hooks/pre-commit"), [], {
			cwd: root,
			env,
			encoding: "utf8",
		});
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stderr, /default branch protection|HEAD/);
		assert.doesNotMatch(result.stdout, /gate-new/);
	});
}

test("feature and valid detached commits execute their checkout gate once and propagate failure", () => {
	const { git, commit } = fixture();
	for (const detached of [false, true]) {
		if (detached) assert.equal(git("switch", "--detach").status, 0);
		const success = commit();
		assert.equal(success.status, 0, success.stderr);
		assert.equal(
			((success.stdout + success.stderr).match(/gate-new/g) || []).length,
			1,
		);
		const head = git("rev-parse", "HEAD").stdout;
		const fail = commit(undefined, { GATE_EXIT: "23" });
		assert.notEqual(fail.status, 0);
		assert.equal(
			((fail.stdout + fail.stderr).match(/gate-new/g) || []).length,
			1,
		);
		assert.equal(git("rev-parse", "HEAD").stdout, head);
	}
});

test("migration recognizes exact protected v1 and repairs legacy downgrades through old pre-commit entry", async () => {
	const { root, hook, commit, git, env } = fixture();
	for (const historical of [
		"pre-commit-shim-v1",
		"pre-commit-shim-v1-head-checks",
	]) {
		const protectedShim = readFileSync(
			new URL(`scripts/lib/fixtures/${historical}`, source),
			"utf8",
		);
		writeFileSync(hook, protectedShim, { mode: 0o755 });
		await ensureSharedHook(root, { env });
		assert.match(readFileSync(hook, "utf8"), /shim-version: 2/);
	}

	writeFileSync(hook, LEGACY_SHIM, { mode: 0o755 });
	assert.equal(commit().status, 0);
	assert.match(readFileSync(hook, "utf8"), /shim-version: 2/);
	git("switch", "-c", "main");
	writeFileSync(hook, LEGACY_SHIM, { mode: 0o755 });
	const refused = commit();
	assert.notEqual(refused.status, 0);
	assert.doesNotMatch(refused.stdout, /gate-new/);
	// Both compatibility entry and preflight repair the historical downgrade.
	await ensureSharedHook(root, { env });
	assert.match(readFileSync(hook, "utf8"), /shim-version: 2/);
});

test("alternating and parallel actual setup keeps newer bootstrap and both checkout-specific gates", async () => {
	const { root, env, git, hook, commit } = fixture();
	assert.equal(
		git(
			"add",
			"scripts",
			"Makefile",
			"package.json",
			"pnpm-workspace.yaml",
			"pnpm-lock.yaml",
		).status,
		0,
	);
	assert.equal(commit().status, 0);
	const rootVersion = git("rev-parse", "HEAD").stdout;
	const linked = join(root, "linked");
	assert.equal(git("worktree", "add", "-b", "other", linked).status, 0);
	checkout(linked, "gate-other", 3);
	const guard = join(linked, "scripts/hooks/check-default-branch");
	writeFileSync(guard, `${readFileSync(guard, "utf8")}echo guard-other\n`);
	assert.equal(git("-C", linked, "add", "scripts").status, 0);
	assert.equal(commit(linked).status, 0);
	assert.notEqual(git("-C", linked, "rev-parse", "HEAD").stdout, rootVersion);
	const bin = join(root, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pnpm"), "#!/bin/sh\nmkdir -p node_modules\n", {
		mode: 0o755,
	});
	const setupEnv = { ...env, PATH: `${bin}:${env.PATH}` };
	const setup = (cwd) =>
		new Promise((resolve, reject) => {
			const child = spawn("make", ["setup"], {
				cwd,
				env: setupEnv,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			child.stdout.on("data", (chunk) => {
				output += chunk;
			});
			child.stderr.on("data", (chunk) => {
				output += chunk;
			});
			child.on("error", reject);
			child.on("close", (status) =>
				status === 0 ? resolve() : reject(new Error(output)),
			);
		});
	for (const cwd of [root, linked, root, linked, root]) await setup(cwd);
	await Promise.all([setup(root), setup(linked)]);
	assert.match(readFileSync(hook, "utf8"), /shim-version: 3/);
	assert.ok(statSync(hook).mode & 0o111);
	assert.equal(existsSync(`${hook}.pfdsl-lock`), false);
	for (const [cwd, label] of [
		[root, "gate-new"],
		[linked, "gate-other"],
	]) {
		const ready = spawnSync(
			process.execPath,
			["scripts/setup-completion.mjs", "check"],
			{ cwd, env: setupEnv, encoding: "utf8" },
		);
		assert.equal(ready.status, 0, ready.stderr);
		const result = commit(cwd);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			((result.stdout + result.stderr).match(new RegExp(label, "g")) || [])
				.length,
			1,
		);
	}
});

test("custom hook content, mode and configuration remain unchanged on incompatible migration", async () => {
	const { root, env, git } = fixture();
	mkdirSync(join(root, "custom"));
	const custom = join(root, "custom/pre-commit");
	const text = "#!/bin/sh\necho custom\n";
	writeFileSync(custom, text, { mode: 0o700 });
	assert.equal(git("config", "core.hooksPath", "custom").status, 0);
	const before = git(
		"config",
		"--show-origin",
		"--get",
		"core.hooksPath",
	).stdout;
	await assert.rejects(ensureSharedHook(root, { env }), /custom/);
	assert.equal(readFileSync(custom, "utf8"), text);
	assert.equal(statSync(custom).mode & 0o777, 0o700);
	assert.equal(
		git("config", "--show-origin", "--get", "core.hooksPath").stdout,
		before,
	);
});
