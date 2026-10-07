import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

describe("generated root instructions repository scope at the entrypoint", () => {
	let root;
	let primary;
	let linked;
	let foreign;
	let scratch;
	const env = { ...process.env, CLAUDE_PROJECT_DIR: "" };
	for (const key of Object.keys(env)) {
		if (key.startsWith("GIT_")) delete env[key];
	}
	const git = (...args) => {
		const result = spawnSync("git", args, { encoding: "utf8", env });
		assert.equal(result.status, 0, result.stderr);
	};
	before(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "pfdsl-generated-scope-")));
		primary = join(root, "primary");
		linked = join(root, "linked");
		foreign = join(root, "foreign");
		scratch = join(root, "scratch");
		git("init", "-q", "-b", "main", primary);
		git(
			"-C",
			primary,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.test",
			"commit",
			"--allow-empty",
			"-qm",
			"fixture",
		);
		git("-C", primary, "worktree", "add", "--detach", linked);
		git("init", "-q", foreign);
		mkdirSync(scratch);
		mkdirSync(join(primary, "nested"));
		symlinkSync(primary, join(scratch, "own-link"));
		symlinkSync(join(primary, "nested"), join(scratch, "nested-link"));
		symlinkSync(foreign, join(scratch, "foreign-link"));
	});
	after(() => {
		if (root) rmSync(root, { recursive: true, force: true });
	});

	function run(tool, path, { cwd = linked, projectDir = "", command } = {}) {
		const result = spawnSync(
			process.execPath,
			[
				new URL("./generated-root-instructions-guard.mjs", import.meta.url)
					.pathname,
			],
			{
				input: JSON.stringify({
					tool_name: tool,
					cwd,
					tool_input:
						tool === "apply_patch"
							? {
									command:
										command ??
										`*** Begin Patch\n*** Add File: ${path}\n+fixture\n*** End Patch`,
								}
							: {
									file_path: path,
									content: "fixture",
									old_string: "old",
									new_string: "new",
								},
				}),
				env: { ...env, CLAUDE_PROJECT_DIR: projectDir },
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
	}

	for (const tool of ["Edit", "Write", "apply_patch"]) {
		for (const [name, target, expected] of [
			["primary root", () => join(primary, "AGENTS.md"), "deny"],
			["linked root", () => join(linked, "CLAUDE.md"), "deny"],
			[
				"nested same-name file",
				() => join(primary, "nested", "AGENTS.md"),
				"allow",
			],
			["foreign repository root", () => join(foreign, "AGENTS.md"), "allow"],
			["scratch same-name file", () => join(scratch, "CLAUDE.md"), "allow"],
			[
				"symlink to protected root",
				() => join(scratch, "own-link", "AGENTS.md"),
				"deny",
			],
			[
				"symlink to foreign root",
				() => join(scratch, "foreign-link", "AGENTS.md"),
				"allow",
			],
		]) {
			it(`${tool} ${expected}: ${name}`, () => {
				const result = run(tool, target());
				assert.equal(result?.permissionDecision ?? "allow", expected);
				if (expected === "deny")
					assert.match(result.permissionDecisionReason, /make gen-plugin/);
			});
		}
	}
	it("Claude retains the session repository after cwd enters a foreign repository", () => {
		assert.equal(
			run("Write", join(primary, "AGENTS.md"), {
				cwd: foreign,
				projectDir: primary,
			})?.permissionDecision,
			"deny",
		);
		assert.equal(
			run("Write", join(foreign, "AGENTS.md"), {
				cwd: foreign,
				projectDir: primary,
			}),
			null,
		);
	});
	it("a relative foreign file stays outside the session repository", () => {
		assert.equal(run("Write", "../foreign/AGENTS.md", { cwd: primary }), null);
	});
	it("a symlink cwd retains the physical session repository", () => {
		assert.equal(
			run("Write", join(primary, "AGENTS.md"), {
				cwd: join(scratch, "nested-link"),
			})?.permissionDecision,
			"deny",
		);
	});
	it("a symlink Claude project directory retains the physical session repository", () => {
		assert.equal(
			run("Write", join(primary, "AGENTS.md"), {
				projectDir: join(scratch, "nested-link"),
			})?.permissionDecision,
			"deny",
		);
	});
	it("a foreign first patch target does not exempt a later protected target", () => {
		const command = `*** Begin Patch\n*** Add File: ${join(foreign, "AGENTS.md")}\n+foreign\n*** Add File: ${join(primary, "AGENTS.md")}\n+generated\n*** End Patch`;
		assert.equal(
			run("apply_patch", undefined, { command })?.permissionDecision,
			"deny",
		);
	});
});
