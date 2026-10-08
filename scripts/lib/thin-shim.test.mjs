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
import { ensureSharedHook } from "../shared-hooks.mjs";

const source = new URL("../../", import.meta.url);
const roots = [];
const localFiles = [
	"scripts/pre-commit",
	"scripts/hooks/check-default-branch",
	"scripts/shared-hooks.mjs",
	"scripts/setup-completion.mjs",
	"scripts/link-repo-skill.mjs",
	"scripts/lib/cli-entrypoint.mjs",
	"scripts/lib/repo-skill-link.mjs",
	"scripts/hooks/pre-commit-shim",
	"Makefile",
];
function checkout(root, label = "gate-new") {
	for (const file of localFiles) {
		const input = new URL(file, source);
		if (!existsSync(input)) continue;
		mkdirSync(dirname(join(root, file)), { recursive: true });
		copyFileSync(input, join(root, file));
	}
	const prefix = readFileSync(
		new URL("scripts/pre-commit", source),
		"utf8",
	).split("# Biome's own exit code")[0];
	writeFileSync(
		join(root, "scripts/pre-commit"),
		`${prefix}echo ${label}\nexit \${GATE_EXIT:-0}\n`,
		{ mode: 0o755 },
	);
	mkdirSync(join(root, "generated/skills/pfdsl"), { recursive: true });
	writeFileSync(
		join(root, "generated/skills/pfdsl/SKILL.md"),
		"fixture skill\n",
	);
	writeFileSync(join(root, "package.json"), "{}\n");
	writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
	writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
}
function fixture({ guardInHead = true } = {}) {
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
	assert.equal(git("add", "scripts").status, 0);
	if (!guardInHead)
		assert.equal(
			git("rm", "--cached", "scripts/hooks/check-default-branch").status,
			0,
		);
	assert.equal(
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"-qm",
			"install checkout guard",
		).status,
		0,
	);
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

for (const staged of [false, true]) {
	test(`default branch refuses an ${staged ? "indexed" : "unstaged"} guard that exits successfully`, () => {
		const { root, git, commit } = fixture();
		assert.equal(git("switch", "-c", "main").status, 0);
		writeFileSync(
			join(root, "scripts/hooks/check-default-branch"),
			"#!/bin/sh\nexit 0\n",
		);
		writeFileSync(join(root, "staged.txt"), "unrelated\n");
		assert.equal(git("add", "staged.txt").status, 0);
		if (staged)
			assert.equal(git("add", "scripts/hooks/check-default-branch").status, 0);
		const head = git("rev-parse", "HEAD").stdout;
		const index = git("ls-files", "--stage", "-z").stdout;
		const result = commit();
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(
			result.stderr,
			/commits on the default branch 'main' are refused/,
		);
		assert.doesNotMatch(result.stdout + result.stderr, /gate-new/);
		assert.equal(git("rev-parse", "HEAD").stdout, head);
		assert.equal(git("ls-files", "--stage", "-z").stdout, index);
	});
}

test("a valid indexed guard is checked before commit while gates use the working tree", () => {
	const { root, git, commit } = fixture();
	const guard = join(root, "scripts/hooks/check-default-branch");
	writeFileSync(
		guard,
		`${readFileSync(guard, "utf8")}echo proposed-guard >&2\n`,
	);
	const gate = join(root, "scripts/pre-commit");
	writeFileSync(
		gate,
		readFileSync(gate, "utf8").replace("gate-new", "gate-edited"),
	);
	assert.equal(git("add", "scripts/hooks/check-default-branch").status, 0);
	const first = commit();
	assert.equal(first.status, 0, first.stderr);
	assert.match(first.stdout + first.stderr, /gate-edited/);
	assert.match(first.stdout + first.stderr, /proposed-guard/);
	const second = commit();
	assert.equal(second.status, 0, second.stderr);
	assert.match(second.stderr, /proposed-guard/);
	assert.match(second.stdout + second.stderr, /gate-edited/);
});

test("a missing guard in HEAD refuses commit without a working-tree fallback", () => {
	const { commit } = fixture({ guardInHead: false });
	const failed = commit();
	assert.notEqual(failed.status, 0);
	assert.match(failed.stderr, /cannot read.*check-default-branch from HEAD/);
	assert.doesNotMatch(failed.stdout + failed.stderr, /gate-new/);
});

for (const detached of [false, true]) {
	for (const fault of ["syntax", "nonzero"]) {
		test(`${detached ? "detached" : "feature"} commit refuses an indexed ${fault} guard and accepts its correction`, () => {
			const { root, git, commit } = fixture();
			if (detached) assert.equal(git("switch", "--detach").status, 0);
			const guard = join(root, "scripts/hooks/check-default-branch");
			const valid = readFileSync(guard, "utf8");
			writeFileSync(
				guard,
				fault === "syntax"
					? "#!/bin/sh\nexit 0\nif then\n"
					: "#!/bin/sh\nexit 23\n",
			);
			assert.equal(git("add", "scripts/hooks/check-default-branch").status, 0);
			// A corrected worktree must not hide the broken version in the index.
			writeFileSync(guard, valid);
			const head = git("rev-parse", "HEAD").stdout;
			const index = git("ls-files", "--stage", "-z").stdout;
			const failed = commit();
			assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
			assert.doesNotMatch(failed.stdout + failed.stderr, /gate-new/);
			assert.equal(git("rev-parse", "HEAD").stdout, head);
			assert.equal(git("ls-files", "--stage", "-z").stdout, index);
			assert.equal(git("add", "scripts/hooks/check-default-branch").status, 0);
			const corrected = commit();
			assert.equal(corrected.status, 0, corrected.stderr);
			assert.match(corrected.stdout + corrected.stderr, /gate-new/);
		});
	}
}

test("an indexed guard deletion is refused before it can break subsequent commits", () => {
	const { git, commit } = fixture();
	assert.equal(
		git("rm", "--cached", "scripts/hooks/check-default-branch").status,
		0,
	);
	const head = git("rev-parse", "HEAD").stdout;
	assert.notEqual(commit().status, 0);
	assert.equal(git("rev-parse", "HEAD").stdout, head);
	assert.equal(git("add", "scripts/hooks/check-default-branch").status, 0);
	assert.equal(commit().status, 0);
});

test("an indexed non-executable guard is refused even with an executable working copy", () => {
	const { root, git, commit } = fixture();
	assert.equal(
		git("update-index", "--chmod=-x", "scripts/hooks/check-default-branch")
			.status,
		0,
	);
	assert.ok(
		statSync(join(root, "scripts/hooks/check-default-branch")).mode & 0o111,
	);
	const head = git("rev-parse", "HEAD").stdout;
	assert.notEqual(commit().status, 0);
	assert.equal(git("rev-parse", "HEAD").stdout, head);
	assert.equal(
		git("update-index", "--chmod=+x", "scripts/hooks/check-default-branch")
			.status,
		0,
	);
	assert.equal(commit().status, 0);
});

test("an unstaged broken guard is not the proposed guard", () => {
	const { root, commit } = fixture();
	writeFileSync(
		join(root, "scripts/hooks/check-default-branch"),
		"#!/bin/sh\nexit 23\n",
	);
	const result = commit();
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout + result.stderr, /gate-new/);
});

test("shared bootstrap refuses a missing checkout entry on feature and default branches", () => {
	const { root, git, commit } = fixture();
	rmSync(join(root, "scripts/pre-commit"));
	for (const branch of ["feature", "main"]) {
		if (branch === "main") assert.equal(git("switch", "-c", branch).status, 0);
		writeFileSync(join(root, "staged.txt"), branch);
		assert.equal(git("add", "staged.txt").status, 0);
		const head = git("rev-parse", "HEAD").stdout;
		const index = git("ls-files", "--stage", "-z").stdout;
		const result = commit();
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stderr, /pre-commit.*missing/i);
		assert.doesNotMatch(result.stdout + result.stderr, /gate-new/);
		assert.equal(git("rev-parse", "HEAD").stdout, head);
		assert.equal(git("ls-files", "--stage", "-z").stdout, index);
	}
});

for (const path of [
	"scripts/pre-commit",
	"scripts/hooks/check-default-branch",
]) {
	test(`missing or non-executable ${path} fails both readiness and Git commit`, () => {
		const { root, commit, env } = fixture();
		const target = join(root, path);
		if (existsSync(target)) chmodSync(target, 0o644);
		const reason = inspectHooksPath(root, { env }).reason;
		assert.match(reason, /Restore.*repository files.*executable modes/);
		assert.doesNotMatch(reason, /Run 'make setup' to install/);
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

test("commit needs no installer", () => {
	const { root, commit, env } = fixture();
	rmSync(join(root, "scripts/shared-hooks.mjs"));
	assert.equal(inspectHooksPath(root, { env }).reason, null);
	const result = commit();
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout + result.stderr, /gate-new/);
});

test("setup and readiness reject a different shim even when its version comment is newer", async () => {
	const { root, hook, env } = fixture();
	const changed = `${readFileSync(hook, "utf8")}# pfdsl-pre-commit-shim-version: 99\n`;
	writeFileSync(hook, changed);
	assert.notEqual(inspectHooksPath(root, { env }).reason, null);
	await assert.rejects(
		ensureSharedHook(root, { env }),
		/refusing to overwrite/,
	);
	assert.equal(readFileSync(hook, "utf8"), changed);
});

test("alternating and parallel setup keeps the same bootstrap and different checkout-specific gates", async () => {
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
	checkout(linked, "gate-other");
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
	assert.equal(
		readFileSync(hook, "utf8"),
		readFileSync(join(root, "scripts/hooks/pre-commit-shim"), "utf8"),
	);
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
	const installed = readFileSync(hook, "utf8");
	const gate = join(linked, "scripts/pre-commit");
	writeFileSync(
		gate,
		readFileSync(gate, "utf8")
			.replace("gate-other", "gate-changed")
			.replace(/exit \$\{GATE_EXIT:-0\}/, "exit 73"),
	);
	const failed = commit(linked);
	assert.notEqual(failed.status, 0);
	assert.match(failed.stdout + failed.stderr, /gate-changed/);
	assert.equal(commit(root).status, 0);
	assert.equal(readFileSync(hook, "utf8"), installed);
});

test("main's copy installer and current setup agree on one shared shim", async () => {
	const { root, env, git, hook, commit } = fixture();
	const mainShim = readFileSync(
		new URL("scripts/lib/fixtures/pre-commit-shim-main-8f81899b", source),
		"utf8",
	);
	const linked = join(root, "main-derived");
	assert.equal(git("worktree", "add", "-b", "main-derived", linked).status, 0);
	checkout(linked, "gate-main-derived");
	writeFileSync(join(linked, "scripts/hooks/pre-commit-shim"), mainShim);
	const bin = join(root, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pnpm"), "#!/bin/sh\nmkdir -p node_modules\n", {
		mode: 0o755,
	});
	const setupEnv = { ...env, PATH: `${bin}:${env.PATH}` };
	for (let iteration = 0; iteration < 3; iteration++) {
		// The main Makefile copies its shim unconditionally (#1415).
		copyFileSync(join(linked, "scripts/hooks/pre-commit-shim"), hook);
		chmodSync(hook, 0o755);
		assert.equal(inspectHooksPath(root, { env }).reason, null);
		await ensureSharedHook(root, { env });
		const setup = spawnSync("make", ["setup"], {
			cwd: root,
			env: setupEnv,
			encoding: "utf8",
		});
		assert.equal(setup.status, 0, setup.stdout + setup.stderr);
		assert.equal(inspectHooksPath(linked, { env }).reason, null);
		assert.equal(readFileSync(hook, "utf8"), mainShim);
		assert.equal(commit(root).status, 0);
		assert.equal(commit(linked).status, 0);
	}
	assert.equal(git("switch", "-c", "main").status, 0);
	const refused = commit(root);
	assert.notEqual(refused.status, 0);
	assert.match(refused.stderr, /commits on the default branch/);
	assert.doesNotMatch(refused.stdout + refused.stderr, /gate-new/);
});

test("custom hook content, mode and configuration remain unchanged", async () => {
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
