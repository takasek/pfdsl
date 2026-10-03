import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
	extractFileTargets,
	resolveFileTargetContext,
} from "./file-target-context.mjs";
import { run, withoutGitTargetEnvironment } from "./run-exec.mjs";

const patch = (body, cwd = "/session") => ({
	tool_name: "apply_patch",
	cwd,
	tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch` },
});

describe("extractFileTargets", () => {
	it("enumerates empty Add operations alone and before another target", () => {
		assert.deepEqual(extractFileTargets(patch("*** Add File: /b/empty")), {
			paths: ["/b/empty"],
		});
		assert.deepEqual(
			extractFileTargets(
				patch("*** Add File: /b/empty\n*** Delete File: /main/file"),
			),
			{ paths: ["/b/empty", "/main/file"] },
		);
	});
	it("enumerates add, update, move source/destination, and delete headers", () => {
		assert.deepEqual(
			extractFileTargets(
				patch(
					"*** Add File: /b/new\n+new\n*** Update File: /b/old\n*** Move to: /b/moved\n@@\n-old\n+new\n*** Delete File: /b/deleted",
				),
			),
			{ paths: ["/b/new", "/b/old", "/b/moved", "/b/deleted"] },
		);
	});
	it("accepts CRLF and a terminal newline without reading patch contents as headers", () => {
		const payload = patch(
			"*** Add File: /b/file\n+*** Delete File: /main/file",
		);
		payload.tool_input.command = `${payload.tool_input.command}\n`.replaceAll(
			"\n",
			"\r\n",
		);
		assert.deepEqual(extractFileTargets(payload), { paths: ["/b/file"] });
	});
	it("rejects every relative Codex target even when session cwd is available", () => {
		for (const body of [
			"*** Add File: file\n+x",
			"*** Update File: /b/file\n*** Move to: ../main/file\n@@\n-x\n+y",
		]) {
			assert.match(extractFileTargets(patch(body)).error, /absolute/);
		}
	});
	it("rejects malformed and unknown patch structure", () => {
		for (const command of [
			"",
			"*** Begin Patch\n*** Update File: /b/x\n*** Copy to: /main/x\n*** End Patch",
			"*** Begin Patch\n*** Move to: /b/x\n*** End Patch",
			"*** Begin Patch\n*** Add File: /b/x\n+x",
			"*** Begin Patch\n*** Delete File: /b/x\n+unexpected\n*** End Patch",
			"*** Begin Patch\n*** Update File: /b/x\n*** End Patch",
			"*** Begin Patch\n*** Update File: /b/x\n*** Move to: /b/y\n*** Move to: /main/y\n@@\n-x\n+y\n*** End Patch",
		]) {
			assert.ok(
				extractFileTargets({
					tool_name: "apply_patch",
					tool_input: { command },
				}).error,
			);
		}
	});
	it("resolves Claude relative paths from execution cwd, preserving symlink traversal", () => {
		assert.deepEqual(
			extractFileTargets({
				tool_name: "Edit",
				cwd: "/b",
				tool_input: { file_path: "link/../file" },
			}),
			{ paths: ["/b/link/../file"] },
		);
	});
	it("rejects missing paths and relative paths without an absolute execution cwd", () => {
		for (const payload of [
			{ tool_name: "Write" },
			{ tool_name: "Edit", tool_input: { file_path: "file" } },
			{ tool_name: "Edit", cwd: "relative", tool_input: { file_path: "file" } },
		]) {
			assert.ok(extractFileTargets(payload).error);
		}
	});
});

describe("file target hook entrypoints", () => {
	let root;
	let repo;
	let nested;
	let external;
	let foreign;
	const cleanEnv = () => {
		const env = withoutGitTargetEnvironment();
		delete env.CLAUDE_PROJECT_DIR;
		return env;
	};
	const git = (cwd, ...args) =>
		run("git", args, { cwd, env: cleanEnv(), captureStderr: true });
	const edit = (file_path, cwd = repo) => ({
		tool_name: "Write",
		cwd,
		tool_input: { file_path },
	});
	const hook = (name, payload, environment = cleanEnv()) => {
		const output = run(
			process.execPath,
			[new URL(`../${name}.mjs`, import.meta.url).pathname],
			{ cwd: repo, input: JSON.stringify(payload), env: environment },
		);
		return output.trim()
			? JSON.parse(output).hookSpecificOutput.permissionDecision
			: "allow";
	};
	before(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "file-target-context-")));
		repo = join(root, "repo");
		nested = join(repo, "worktrees", "nested");
		external = join(root, "external");
		foreign = join(root, "foreign");
		for (const dir of [repo, foreign]) {
			mkdirSync(dir);
			git(dir, "init", "-b", "main");
			git(
				dir,
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"--allow-empty",
				"-m",
				"init",
			);
		}
		git(repo, "worktree", "add", "-b", "nested-feature", nested);
		git(repo, "worktree", "add", "-b", "external-feature", external);
		mkdirSync(join(repo, "directory"));
		symlinkSync(join(repo, "directory"), join(external, "main-link"));
		symlinkSync(external, join(root, "alias"));
		writeFileSync(join(external, "AGENTS.md"), "generated");
		symlinkSync(
			join(external, "AGENTS.md"),
			join(external, "instructions-link"),
		);
	});
	after(() => rmSync(root, { recursive: true, force: true }));

	it("allows both nested and external feature targets from the original main session", () => {
		for (const target of [nested, external, join(root, "alias")]) {
			assert.equal(
				hook("worktree-write-guard", edit(join(target, "missing", "new.txt"))),
				"allow",
			);
			assert.equal(
				hook(
					"worktree-write-guard",
					patch(`*** Add File: ${target}/missing/new.txt\n+x`, repo),
				),
				"allow",
			);
		}
	});
	it("checks protected targets in large patches within the configured hook timeout", () => {
		for (let index = 0; index < 400; index++) {
			mkdirSync(join(external, `group-${index}`));
			mkdirSync(join(repo, `group-${index}`));
		}
		const featureBody = Array.from(
			{ length: 400 },
			(_, index) => `*** Add File: ${external}/group-${index}/new.txt\n+x`,
		).join("\n");
		const mainBody = Array.from(
			{ length: 400 },
			(_, index) => `*** Add File: ${repo}/group-${index}/new.txt\n+x`,
		).join("\n");
		for (const [name, body] of [
			["worktree-write-guard", mainBody],
			[
				"generated-root-instructions-guard",
				`${featureBody}\n*** Add File: ${external}/AGENTS.md\n+x`,
			],
		]) {
			const output = execFileSync(
				process.execPath,
				[new URL(`../${name}.mjs`, import.meta.url).pathname],
				{
					cwd: repo,
					input: JSON.stringify(patch(body, repo)),
					env: cleanEnv(),
					encoding: "utf8",
					timeout: 5000,
				},
			);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				"deny",
			);
		}
	});
	it("allows a nested sibling feature checkout from an external feature session", () => {
		assert.equal(
			hook("worktree-write-guard", edit(join(nested, "new"), external)),
			"allow",
		);
		assert.equal(
			hook(
				"worktree-write-guard",
				patch(`*** Add File: ${nested}/new\n+x`, external),
			),
			"allow",
		);
	});
	it("allows foreign and scratch targets but rejects an explicit main target", () => {
		for (const target of [join(foreign, "new"), join(root, "scratch", "new")]) {
			assert.equal(
				hook("worktree-write-guard", edit(target, external)),
				"allow",
			);
		}
		assert.equal(hook("worktree-write-guard", edit(join(repo, "new"))), "deny");
	});
	it("uses Claude's moved cwd for relative paths and original project root for scope", () => {
		const environment = { ...cleanEnv(), CLAUDE_PROJECT_DIR: repo };
		assert.equal(
			hook("worktree-write-guard", edit("new", external), environment),
			"allow",
		);
		assert.equal(
			hook("worktree-write-guard", edit("../repo/new", external), environment),
			"deny",
		);
	});
	it("resolves symlinks before dot-dot and finds the nearest existing parent", () => {
		const context = resolveFileTargetContext(
			edit(`${external}/main-link/../missing/new`),
			{ environment: cleanEnv() },
		);
		assert.equal(context.targets[0].path, join(repo, "missing", "new"));
		assert.equal(context.targets[0].roots.worktreeRoot, repo);
		assert.equal(
			hook(
				"worktree-write-guard",
				edit(`${external}/main-link/../missing/new`),
			),
			"deny",
		);
	});
	it("rejects a mixed patch when any move target reaches main", () => {
		assert.equal(
			hook(
				"worktree-write-guard",
				patch(
					`*** Add File: ${external}/new\n+x\n*** Update File: ${nested}/old\n*** Move to: ${repo}/moved\n@@\n-old\n+new`,
					repo,
				),
			),
			"deny",
		);
	});
	it("allows an empty feature Add but checks later protected targets", () => {
		assert.equal(
			hook(
				"worktree-write-guard",
				patch(`*** Add File: ${external}/empty`, repo),
			),
			"allow",
		);
		assert.equal(
			hook(
				"worktree-write-guard",
				patch(
					`*** Add File: ${external}/empty\n*** Delete File: ${repo}/file`,
					repo,
				),
			),
			"deny",
		);
		assert.equal(
			hook(
				"generated-root-instructions-guard",
				patch(
					`*** Add File: ${external}/empty\n*** Add File: ${external}/AGENTS.md`,
					repo,
				),
			),
			"deny",
		);
	});
	it("guards the target worktree's generated roots, including symlink aliases", () => {
		for (const path of [
			join(external, "AGENTS.md"),
			join(external, "instructions-link"),
		]) {
			assert.equal(
				hook(
					"generated-root-instructions-guard",
					patch(`*** Update File: ${path}\n@@\n-old\n+new`, repo),
				),
				"deny",
			);
		}
		assert.equal(
			hook(
				"generated-root-instructions-guard",
				edit(join(external, "nested", "AGENTS.md")),
			),
			"allow",
		);
		assert.equal(
			hook(
				"generated-root-instructions-guard",
				edit(join(foreign, "AGENTS.md")),
			),
			"allow",
		);
		assert.equal(
			hook(
				"generated-root-instructions-guard",
				patch(`*** Delete File: ${external}/AGENTS.md`, repo),
			),
			"deny",
		);
		assert.equal(
			hook(
				"generated-root-instructions-guard",
				patch(
					`*** Update File: ${external}/source\n*** Move to: ${external}/AGENTS.md\n@@\n-old\n+new`,
					repo,
				),
			),
			"deny",
		);
	});
	it("strips ambient Git target overrides from all identity probes", () => {
		const environment = {
			...cleanEnv(),
			GIT_DIR: join(foreign, ".git"),
			GIT_WORK_TREE: foreign,
		};
		assert.equal(
			hook("worktree-write-guard", edit(join(repo, "new")), environment),
			"deny",
		);
		assert.equal(
			hook("worktree-write-guard", edit(join(external, "new")), environment),
			"allow",
		);
	});
	it("rejects relative and malformed Codex patches in both guards", () => {
		for (const name of [
			"worktree-write-guard",
			"generated-root-instructions-guard",
		]) {
			assert.equal(hook(name, patch("*** Add File: file\n+x", repo)), "deny");
			assert.equal(
				hook(
					name,
					patch(
						`*** Update File: ${external}/file\n*** Copy to: ${repo}/file`,
						repo,
					),
				),
				"deny",
			);
		}
	});
	it("does not classify failed Git resolution as a confirmed scratch directory", () => {
		const context = resolveFileTargetContext(edit(join(repo, "new")), {
			environment: cleanEnv(),
			resolveRoots: () => null,
		});
		assert.equal(context.sessionRoots, null);
		assert.equal(context.targets[0].outsideRepository, false);
	});
	it("denies dangling symlinks instead of attributing them to their parent checkout", () => {
		const link = join(external, "dangling");
		symlinkSync(join(root, "nonexistent-destination"), link);
		assert.equal(hook("worktree-write-guard", edit(link)), "deny");
	});
	it("uses origin/HEAD when the default branch has a different name", () => {
		try {
			git(
				repo,
				"symbolic-ref",
				"refs/remotes/origin/HEAD",
				"refs/remotes/origin/external-feature",
			);
			assert.equal(
				hook("worktree-write-guard", edit(join(external, "new"))),
				"deny",
			);
			assert.equal(
				hook("worktree-write-guard", edit(join(repo, "new"))),
				"allow",
			);
		} finally {
			git(repo, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
		}
	});
});
