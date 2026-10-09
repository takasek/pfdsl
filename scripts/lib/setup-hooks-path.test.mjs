import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	inspectHooksPath,
	isSetupCurrent,
	writeSetupMarker,
} from "../setup-completion.mjs";

const fixtures = [];
const shim = readFileSync(new URL("../hooks/pre-commit-shim", import.meta.url));
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-hooks-path-"));
	fixtures.push(root);
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: join(root, "global-config"),
		GIT_CONFIG_SYSTEM: join(root, "system-config"),
	};
	for (const name of [
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_COMMON_DIR",
		"GIT_CONFIG_COUNT",
	])
		delete env[name];
	const git = (...args) => {
		const r = spawnSync("/usr/bin/git", args, {
			cwd: root,
			env,
			encoding: "utf8",
		});
		assert.equal(r.status, 0, r.stderr);
		return r.stdout.trim();
	};
	git("init", "-q");
	mkdirSync(join(root, "scripts/hooks"), { recursive: true });
	writeFileSync(join(root, "scripts/hooks/pre-commit-shim"), shim);
	writeFileSync(join(root, "scripts/pre-commit"), "#!/bin/sh\nexit 0\n", {
		mode: 0o755,
	});
	for (const entry of ["scripts/hooks/check-default-branch"]) {
		writeFileSync(join(root, entry), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	}
	mkdirSync(join(root, "generated/skills/pfdsl"), { recursive: true });
	writeFileSync(
		join(root, "generated/skills/pfdsl/SKILL.md"),
		"fixture skill\n",
	);
	mkdirSync(join(root, ".claude/skills"), { recursive: true });
	symlinkSync(
		"../../generated/skills/pfdsl",
		join(root, ".claude/skills/pfdsl"),
	);
	writeSetupMarker(root);
	return { root, env, git };
}
function install(root, directory, text = shim) {
	mkdirSync(join(root, directory), { recursive: true });
	writeFileSync(join(root, directory, "pre-commit"), text, { mode: 0o755 });
}
afterEach(() => {
	for (const root of fixtures.splice(0))
		rmSync(root, { recursive: true, force: true });
});
describe("effective core.hooksPath", () => {
	it("rejects an override without the repo shim even with a current marker", () => {
		const { root, env, git } = fixture();
		git("config", "core.hooksPath", "custom-hooks");
		assert.match(inspectHooksPath(root, { env }).reason, /core.hooksPath/);
		assert.equal(isSetupCurrent(root, { env }), false);
	});
	it("accepts an executable exact shim in a relative or absolute custom directory", () => {
		const { root, env, git } = fixture();
		install(root, "custom hooks");
		for (const path of ["custom hooks", join(root, "custom hooks")]) {
			git("config", "core.hooksPath", path);
			assert.equal(inspectHooksPath(root, { env }).reason, null);
			assert.equal(isSetupCurrent(root, { env }), true);
		}
	});
	it("accepts a shim symlink, rejects non-executable and unrelated hooks", () => {
		const { root, env, git } = fixture();
		git("config", "core.hooksPath", "custom-hooks");
		mkdirSync(join(root, "custom-hooks"));
		chmodSync(join(root, "scripts/hooks/pre-commit-shim"), 0o755);
		symlinkSync(
			join(root, "scripts/hooks/pre-commit-shim"),
			join(root, "custom-hooks/pre-commit"),
		);
		assert.equal(inspectHooksPath(root, { env }).reason, null);
		chmodSync(join(root, "scripts/hooks/pre-commit-shim"), 0o644);
		assert.match(inspectHooksPath(root, { env }).reason, /executable/);
		rmSync(join(root, "custom-hooks/pre-commit"));
		install(root, "custom-hooks", "#!/bin/sh\n# pre-commit shim\nexit 0\n");
		assert.match(inspectHooksPath(root, { env }).reason, /cannot verify/);
	});
	it("detects global and system overrides with local precedence", () => {
		const { root, env, git } = fixture();
		for (const config of ["global-config", "system-config"]) {
			writeFileSync(join(root, config), "[core]\n hooksPath = absent-hooks\n");
			assert.match(inspectHooksPath(root, { env }).reason, /core.hooksPath/);
		}
		install(root, "valid-hooks");
		git("config", "core.hooksPath", "valid-hooks");
		assert.equal(inspectHooksPath(root, { env }).reason, null);
	});
	it("rejects a missing checkout gate and an empty hooksPath", () => {
		const { root, env, git } = fixture();
		install(root, "custom-hooks");
		git("config", "core.hooksPath", "custom-hooks");
		rmSync(join(root, "scripts/pre-commit"));
		assert.match(inspectHooksPath(root, { env }).reason, /scripts\/pre-commit/);
		git("config", "core.hooksPath", "");
		assert.notEqual(inspectHooksPath(root, { env }).reason, null);
	});
	it("resolves worktree configuration and relative hooks against the linked checkout", () => {
		const { root, env, git } = fixture();
		const linked = join(root, "linked");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"fixture",
		);
		git("worktree", "add", "--detach", "--no-checkout", linked);
		git("config", "extensions.worktreeConfig", "true");
		git("-C", linked, "config", "--worktree", "core.hooksPath", "custom-hooks");
		mkdirSync(join(linked, "scripts/hooks"), { recursive: true });
		writeFileSync(join(linked, "scripts/hooks/pre-commit-shim"), shim);
		writeFileSync(join(linked, "scripts/pre-commit"), "#!/bin/sh\nexit 0\n", {
			mode: 0o755,
		});
		for (const entry of ["scripts/hooks/check-default-branch"]) {
			writeFileSync(join(linked, entry), "#!/bin/sh\nexit 0\n", {
				mode: 0o755,
			});
		}
		assert.match(inspectHooksPath(linked, { env }).reason, /core.hooksPath/);
		install(linked, "custom-hooks");
		assert.equal(inspectHooksPath(linked, { env }).reason, null);
	});
});
describe("setup-managed pre-commit", () => {
	for (const location of [".git/hooks", "custom-hooks"])
		it(`rejects a FIFO in ${location} without blocking the checker`, () => {
			const { root, env, git } = fixture();
			mkdirSync(join(root, location), { recursive: true });
			const fifo = spawnSync("mkfifo", [join(root, location, "pre-commit")]);
			assert.equal(fifo.status, 0, fifo.stderr?.toString());
			if (location === "custom-hooks")
				git("config", "core.hooksPath", location);
			const result = spawnSync(
				process.execPath,
				[
					fileURLToPath(new URL("../setup-completion.mjs", import.meta.url)),
					"check",
				],
				{ cwd: root, env, encoding: "utf8", timeout: 1000 },
			);
			assert.equal(result.error, undefined, result.error?.message);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /not executable|regular file/);
		});
	it("directs a differing managed hook to explicit replacement before setup", () => {
		for (const mode of [0o755, 0o644]) {
			const { root, env } = fixture();
			install(root, ".git/hooks", "#!/bin/sh\nexit 0\n");
			chmodSync(join(root, ".git/hooks/pre-commit"), mode);
			const reason = inspectHooksPath(root, { env }).reason;
			assert.match(reason, /Inspect.*replace.*before running setup/);
			assert.doesNotMatch(reason, /Run 'make setup' to install/);
		}
	});
	it("rejects a different shared shim even with a version comment", () => {
		const { root, env } = fixture();
		install(root, ".git/hooks", `${shim}# pfdsl-pre-commit-shim-version: 99\n`);
		assert.notEqual(inspectHooksPath(root, { env }).reason, null);
		assert.equal(isSetupCurrent(root, { env }), false);
	});
	it("requires the shim in the common-dir hooks when core.hooksPath is unset", () => {
		const { root, env } = fixture();
		const missing = inspectHooksPath(root, { env });
		assert.match(missing.reason, /make setup/);
		assert.equal(missing.managed, true);
		assert.equal(isSetupCurrent(root, { env }), false);
		install(root, ".git/hooks");
		assert.equal(inspectHooksPath(root, { env }).reason, null);
		assert.equal(isSetupCurrent(root, { env }), true);
	});
	it("lets setup repair a hooksPath that selects the common-dir hooks", () => {
		const { root, env, git } = fixture();
		git("config", "core.hooksPath", join(root, ".git/hooks"));
		const managed = inspectHooksPath(root, { env });
		assert.notEqual(managed.reason, null);
		assert.equal(managed.managed, true);
		git("config", "core.hooksPath", "custom-hooks");
		assert.equal(inspectHooksPath(root, { env }).managed, false);
	});
});
describe("pre-commit shim", () => {
	it("fails the commit when the checkout has no scripts/pre-commit", () => {
		const { root, git, env } = fixture();
		rmSync(join(root, "scripts/pre-commit"));
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"fixture",
		);
		git("update-ref", "refs/remotes/origin/default", "HEAD");
		git(
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
			"refs/remotes/origin/default",
		);
		const result = spawnSync(
			"/bin/sh",
			[fileURLToPath(new URL("../hooks/pre-commit-shim", import.meta.url))],
			{ cwd: root, env, encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /scripts\/pre-commit/);
	});
});
