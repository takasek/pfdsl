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
		assert.match(inspectHooksPath(linked, { env }).reason, /core.hooksPath/);
		install(linked, "custom-hooks");
		assert.equal(inspectHooksPath(linked, { env }).reason, null);
	});
});
describe("setup-managed pre-commit", () => {
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
		const root = mkdtempSync(join(tmpdir(), "pfdsl-shim-"));
		fixtures.push(root);
		const result = spawnSync(
			"/bin/sh",
			[fileURLToPath(new URL("../hooks/pre-commit-shim", import.meta.url))],
			{ cwd: root, encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /scripts\/pre-commit/);
	});
});
