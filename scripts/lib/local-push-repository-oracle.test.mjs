import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildFixture, quote } from "./guard-effect-oracle-harness.mjs";
import {
	evaluateMainCommitGuard,
	runMainCommitGuard,
} from "./main-commit-guard.mjs";
import { tryGit } from "./run-exec.mjs";
import { classifySharedGitEffect } from "./shared-git-effects.mjs";

const env = {
	...Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
	),
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_TERMINAL_PROMPT: "0",
	GIT_ALLOW_PROTOCOL: "file",
};

test("local push operands are checked against the effective Git cwd", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-local-push-oracle-"));
	try {
		const { feature, primary } = buildFixture(root);
		mkdirSync(join(feature, "links"));
		mkdirSync(join(feature, "subdir"));
		mkdirSync(join(feature, "origin"));
		mkdirSync(join(feature, "physical", "inner"), { recursive: true });
		symlinkSync("physical/inner", join(feature, "jump"), "dir");
		symlinkSync(
			join(primary, ".git"),
			join(feature, "physical", "path-self"),
			"dir",
		);
		symlinkSync(join(primary, ".git"), join(feature, "self"), "dir");
		symlinkSync(join(primary, ".git"), join(feature, "self:repo"), "dir");
		symlinkSync(join(primary, ".git"), join(feature, "only-space "), "dir");
		symlinkSync(join(primary, ".git"), join(feature, "line\nrepo"), "dir");
		symlinkSync(join(primary, ".git"), join(feature, "file-space "), "dir");
		symlinkSync(join(primary, ".git"), join(feature, "file-hash#tail"), "dir");
		symlinkSync(join(primary, ".git"), join(feature, "suffix-self.git"), "dir");
		symlinkSync(join(primary, ".git"), join(feature, "links", "self"), "dir");
		const git = (...args) => {
			const result = spawnSync("git", args, {
				cwd: feature,
				env,
				encoding: "utf8",
				timeout: 10000,
			});
			assert.equal(result.status, 0, result.stderr);
			return result.stdout.trim();
		};
		const guard = (command, cwd = feature) => {
			const result = runMainCommitGuard(
				JSON.stringify({ tool_name: "Bash", cwd, tool_input: { command } }),
				{
					resolveBranches: () => ({
						currentBranch: "topic",
						mainBranch: "main",
						targetRelation: "own",
					}),
					supportsAsk: false,
				},
			);
			return result.output?.hookSpecificOutput.permissionDecision ?? "allow";
		};
		const topic = git("rev-parse", "HEAD");
		const initial = git("rev-parse", "other");
		for (const [cwd, command] of [
			[feature, "git push self HEAD:refs/heads/other"],
			[feature, "git push ./self:repo HEAD:refs/heads/other"],
			[
				feature,
				`git push ${quote(join(feature, "self:repo"))} HEAD:refs/heads/other`,
			],
			[feature, "git push .git HEAD:refs/heads/other"],
			[feature, "git push .git/ HEAD:refs/heads/other"],
			[feature, "git push 'only-space ' HEAD:refs/heads/other"],
			[
				feature,
				`git push ${quote(`file://${feature}/file-space `)} HEAD:refs/heads/other`,
			],
			[
				feature,
				`git push ${quote(`file://${feature}/file-space%20`)} HEAD:refs/heads/other`,
			],
			[
				feature,
				`git push ${quote(`file://${feature}/file-hash#tail`)} HEAD:refs/heads/other`,
			],
			[
				feature,
				`git push ${quote(`file://${feature}/jump/../path-self`)} HEAD:refs/heads/other`,
			],
			[feature, "git push suffix-self HEAD:refs/heads/other"],
			[feature, "git push links/self HEAD:refs/heads/other"],
			[feature, "git push jump/../path-self HEAD:refs/heads/other"],
			[feature, "git push --repo=self self HEAD:refs/heads/other"],
			[feature, "git push --repo self self HEAD:refs/heads/other"],
			[feature, "git push --rep=self self HEAD:refs/heads/other"],
			[root, `git -C ${quote(feature)} push self HEAD:refs/heads/other`],
			[root, `cd ${quote(feature)} && git push self HEAD:refs/heads/other`],
			[feature, "git -C subdir push self HEAD:refs/heads/other"],
			[feature, "cd subdir && git push self HEAD:refs/heads/other"],
			[join(feature, "subdir"), "git push self HEAD:refs/heads/other"],
			[feature, "git push self :other"],
			// A file named main is in the fixture: it is still a destination.
			[feature, "git push self HEAD:main"],
			[feature, "git push self :main"],
		]) {
			git("update-ref", "refs/heads/other", initial);
			git("update-ref", "refs/heads/main", initial);
			const destination = command.endsWith("main") ? "main" : "other";
			const deletion = command.endsWith(` :${destination}`);
			const result = spawnSync("/bin/bash", ["-c", command], {
				cwd,
				env,
				encoding: "utf8",
				timeout: 10000,
			});
			assert.equal(result.status, 0, `${command}: ${result.stderr}`);
			if (deletion) assert.equal(git("branch", "--list", destination), "");
			else assert.equal(git("rev-parse", destination), topic);
			assert.equal(guard(command, cwd), "deny", command);
		}
		// A bare refspec still denotes a write destination, even when Git would
		// find it already up to date or a file with the same name exists.
		for (const command of [
			"git push self other",
			"git push self main",
			"git push . main",
		])
			assert.equal(guard(command), "deny", command);
		assert.equal(
			classifySharedGitEffect("push", ["self", "HEAD:other"], { cwd: feature })
				?.kind,
			"shared",
		);
		const direct = evaluateMainCommitGuard(
			{
				tool_name: "Bash",
				cwd: feature,
				tool_input: { command: "git push self HEAD:other" },
			},
			{ currentBranch: "topic", mainBranch: "main" },
		);
		assert.equal(direct.decision, "ask", JSON.stringify(direct));

		for (const command of [
			"git push origin main",
			"git push --receive-pack self origin topic",
			"git push origin HEAD:refs/heads/new-topic",
			"git push self HEAD:refs/tags/new-tag",
			"git push self HEAD:refs/remotes/example/topic",
			"git push self",
			"git push https://example.test/repo HEAD:other",
			"git push user@example.test:repo HEAD:other",
		])
			assert.equal(guard(command), "allow", command);
		assert.equal(guard('cd "$UNKNOWN" && git push self HEAD:other'), "deny");
		for (const failedProbe of ["remote", "rev-parse"]) {
			const effect = classifySharedGitEffect("push", ["self", "HEAD:other"], {
				cwd: join(feature, "subdir"),
				exec: (args, opts) =>
					args[0] === failedProbe
						? { ok: false, timedOut: true, out: "" }
						: tryGit(args, opts),
			});
			assert.equal(effect?.unresolved, true, failedProbe);
		}
		git("remote", "add", "local-self", "self");
		git("remote", "add", "newline-self", "line\nrepo");
		git("remote", "add", "multiple", join(root, "origin.git"));
		git(
			"remote",
			"set-url",
			"--add",
			"--push",
			"multiple",
			join(root, "origin.git"),
		);
		git("remote", "set-url", "--add", "--push", "multiple", "self");
		git("config", `url.${feature}/.pushInsteadOf`, "alias:");
		git("remote", "add", "rewritten-self", "alias:self");
		for (const remote of [
			"local-self",
			"multiple",
			"rewritten-self",
			"newline-self",
		]) {
			git("update-ref", "refs/heads/other", initial);
			git("push", remote, "HEAD:refs/heads/other");
			assert.equal(git("rev-parse", "other"), topic, remote);
			assert.equal(guard(`git push ${remote} HEAD:other`), "deny", remote);
		}
		assert.equal(guard("git push origin HEAD:refs/heads/new-topic"), "allow");
		// Raw pushInsteadOf cannot be obtained by a no-contact Git query.
		assert.equal(guard("git push alias:self HEAD:other"), "deny");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
