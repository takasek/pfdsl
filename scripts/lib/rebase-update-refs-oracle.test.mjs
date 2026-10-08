import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parentDecision, quote } from "./guard-effect-oracle-harness.mjs";

test("rebase option values cannot cancel observed updates to other refs", () => {
	const scratch = mkdtempSync(join(tmpdir(), "pfdsl-rebase-values-"));
	const repo = join(scratch, "repo");
	const bin = join(scratch, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "--no-update-refs"), "#!/bin/sh\nexit 0\n", {
		mode: 0o700,
	});
	writeFileSync(join(bin, "--update-refs"), "#!/bin/sh\nexit 0\n", {
		mode: 0o700,
	});
	const env = {
		...Object.fromEntries(
			Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
		),
		PATH: `${bin}:${process.env.PATH}`,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.test",
		GIT_COMMITTER_NAME: "Fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.test",
		GIT_EDITOR: "true",
	};
	const git = (...args) => {
		const result = spawnSync("git", args, {
			cwd: repo,
			env,
			encoding: "utf8",
			timeout: 10000,
		});
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	try {
		mkdirSync(repo);
		git("init", "-q", "-b", "main");
		writeFileSync(join(repo, "base.txt"), "base\n");
		git("add", ".");
		git("commit", "-qm", "base");
		git("switch", "-qc", "upstream");
		writeFileSync(join(repo, "upstream.txt"), "upstream\n");
		git("add", ".");
		git("commit", "-qm", "upstream");
		git("switch", "-qc", "topic", "main");
		writeFileSync(join(repo, "topic.txt"), "topic\n");
		git("add", ".");
		git("commit", "-qm", "topic");
		const original = git("rev-parse", "HEAD");
		const cases = [
			{
				options: ["--update-refs", "--exec", "--no-update-refs"],
				shared: true,
			},
			{ options: ["--update-refs", "-x", "--no-update-refs"], shared: true },
			{ options: ["--update-refs", "--ex", "--no-update-refs"], shared: true },
			{ options: ["--update-r", "-qx", "--no-update-refs"], shared: true },
			{ options: ["--update-refs", "--exec=--no-update-refs"], shared: true },
			{ options: ["--update-refs", "-x--no-update-refs"], shared: true },
			{ options: ["--update-refs", "--no-update-refs"], shared: false },
			{
				options: [
					"--update-refs",
					"--exec",
					"--no-update-refs",
					"--no-update-refs",
				],
				shared: false,
			},
			{
				options: ["--no-update-refs", "--exec", "--update-refs"],
				shared: false,
			},
			{ options: ["--no-update-refs", "--exec=--update-refs"], shared: false },
			{
				options: ["--exec", "--no-update-refs", "--update-refs"],
				shared: true,
			},
			{ options: ["--no-update-refs", "--no-autostash"], shared: false },
			{ options: ["--no-update-refs", "--ignore-date"], shared: false },
			{ options: ["-k"], shared: false },
			{ options: ["--no-update-refs", "-k"], shared: false },
		];
		const violations = [];
		for (const { options, shared } of cases) {
			git("reset", "--hard", original);
			git("branch", "-f", "main", original);
			git("branch", "-f", "other", original);
			const args = ["rebase", ...options, "upstream"];
			git(...args);
			const changed = ["main", "other"].filter(
				(name) => git("rev-parse", name) !== original,
			);
			assert.notEqual(
				git("rev-parse", "topic"),
				original,
				"rebase must actually run",
			);
			assert.equal(changed.length, shared ? 2 : 0, JSON.stringify(options));
			const command = ["git", ...args].map(quote).join(" ");
			const decision = parentDecision(command, repo);
			if (decision !== (changed.length ? "ask" : "allow"))
				violations.push({ command, changed, decision });
		}
		assert.deepEqual(violations, []);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
