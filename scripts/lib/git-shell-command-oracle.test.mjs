import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { childDecision } from "./guard-effect-oracle-harness.mjs";
import { runMainCommitGuard } from "./main-commit-guard.mjs";

for (const shell of ["/bin/bash", "/bin/zsh"]) {
	test(`shell command positions cannot hide observed Git mutations from either guard (${shell})`, (t) => {
		const available = spawnSync(shell, ["-c", ":"]);
		if (available.error?.code === "ENOENT")
			return t.skip(`${shell} is unavailable`);
		assert.equal(available.status, 0);
		const repo = mkdtempSync(join(tmpdir(), "pfdsl-git-shell-position-"));
		const env = {
			...Object.fromEntries(
				Object.entries(process.env).filter(
					([name]) => !name.startsWith("GIT_"),
				),
			),
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
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
		const forms = [
			"{cmd}",
			"exec {cmd}",
			"exec -- {cmd}",
			"exec -a fixture {cmd}",
			"exec -afixture {cmd}",
			"exec -cl {cmd}",
			"builtin exec {cmd}",
			"builtin -- exec {cmd}",
			"builtin command exec {cmd}",
			"builtin builtin exec {cmd}",
			"command exec {cmd}",
			"if {cmd}; then :; fi",
			"if true; then {cmd}; fi; cd .",
			"! {cmd}",
			"if true; then {cmd}; fi",
			"if false; then :; elif {cmd}; then :; fi",
			"if false; then :; else {cmd}; fi",
			"while {cmd}; do break; done",
			"until {cmd}; do :; done",
			"for item in once; do {cmd}; done",
			"{ {cmd}; }",
			"time {cmd}",
			"time -p ! {cmd}",
			"{ time ! {cmd}; }",
			"if ! command exec {cmd}; then :; fi",
			"case x in x) {cmd};; esac",
			"function f { {cmd}; }; f",
			"if FIXTURE=1 exec {cmd}; then :; fi",
			...(shell.endsWith("zsh")
				? [
						"coproc {cmd}; wait",
						"time coproc {cmd}; wait",
						"function { {cmd}; }",
						"function f g { {cmd}; }; f",
						"function -T f g { {cmd}; }; f",
						"repeat 1 {cmd}",
						"repeat 1 do {cmd}; done",
						"repeat 1 { {cmd}; }; cd .",
						"{ :; } always { {cmd}; }",
						"noglob {cmd}",
						"nocorrect {cmd}",
						"FOO=1 noglob {cmd}",
						"FOO=1 nocorrect {cmd}",
						"FOO=1 noglob exec {cmd}",
						"> /dev/null noglob {cmd}",
						"- {cmd}",
					]
				: []),
		];
		const commands = [
			...forms
				.filter(
					(form) =>
						!shell.endsWith("zsh") ||
						(!form.includes("builtin") &&
							!form.includes("command exec") &&
							!form.includes("time -p")),
				)
				.flatMap((form) =>
					["git commit --allow-empty -qm fixture", "git status --short"].map(
						(command) => form.replace("{cmd}", command),
					),
				),
			"echo 'if git commit -m x'",
			"printf '%s' 'exec git commit -m x'",
			"for git in commit; do :; done",
			"case git in git) :;; esac",
			"exec -a git printf '%s' commit",
			"command -v git",
		];
		const violations = [];
		try {
			git("init", "-q", "-b", "main");
			git("config", "user.name", "Fixture");
			git("config", "user.email", "fixture@example.test");
			git("commit", "--allow-empty", "-qm", "base");
			const original = git("rev-parse", "HEAD");
			for (const branch of ["main", "topic"]) {
				git("switch", "-C", branch, original);
				for (const command of commands.filter(
					(value) => branch === "main" || !value.startsWith("case "),
				)) {
					git("reset", "--hard", original);
					const actual = spawnSync(
						shell,
						[
							shell.endsWith("zsh") ? "-f" : "--noprofile",
							...(shell.endsWith("zsh") ? [] : ["--norc"]),
							"-c",
							command,
						],
						{ cwd: repo, env, encoding: "utf8", timeout: 10000 },
					);
					assert.ok(actual.status === 0 || actual.status === 1, actual.stderr);
					const changed = git("rev-parse", "HEAD") !== original;
					const child = childDecision(command);
					const result = runMainCommitGuard(
						JSON.stringify({
							tool_name: "Bash",
							cwd: repo,
							tool_input: { command },
						}),
						{
							resolveBranches: () => ({
								currentBranch: branch,
								mainBranch: "main",
								targetRelation: "own",
							}),
							supportsAsk: false,
						},
					);
					const parent =
						result.output?.hookSpecificOutput.permissionDecision ?? "allow";
					const expected = changed ? "deny" : "allow";
					if (
						child !== expected ||
						parent !== (changed && branch === "main" ? "deny" : "allow")
					)
						violations.push({ branch, command, changed, child, parent });
				}
			}
			assert.deepEqual(violations, []);
			git("switch", "main");
			git("reset", "--hard", original);
			const feature = join(repo, "feature");
			git("worktree", "add", "-q", "-b", "loop-topic", feature);
			const command = `time while git commit --allow-empty -qm fixture; do if [ "$PWD" = '${repo}' ]; then break; fi; cd '${repo}'; done`;
			const actual = spawnSync(shell, ["-c", command], {
				cwd: feature,
				env,
				encoding: "utf8",
				timeout: 10000,
			});
			assert.equal(actual.status, 0, actual.stderr);
			assert.notEqual(
				git("rev-parse", "HEAD"),
				original,
				"later loop iteration changes main",
			);
			assert.equal(childDecision(command), "deny");
			const result = runMainCommitGuard(
				JSON.stringify({
					tool_name: "Bash",
					cwd: feature,
					tool_input: { command },
				}),
				{
					supportsAsk: false,
					resolveBranches: (_segment, cwd) => ({
						currentBranch: cwd === feature ? "loop-topic" : "main",
						mainBranch: "main",
						targetRelation: cwd === feature ? "own" : "sibling",
					}),
				},
			);
			assert.equal(
				result.output?.hookSpecificOutput.permissionDecision,
				"deny",
			);
			git("reset", "--hard", original);
			const delayed = `function f { git commit --allow-empty -qm fixture; }; cd '${repo}'; f`;
			const delayedActual = spawnSync(shell, ["-c", delayed], {
				cwd: feature,
				env,
				encoding: "utf8",
				timeout: 10000,
			});
			assert.equal(delayedActual.status, 0, delayedActual.stderr);
			assert.notEqual(
				git("rev-parse", "HEAD"),
				original,
				"function uses cwd at its call",
			);
			const delayedResult = runMainCommitGuard(
				JSON.stringify({
					tool_name: "Bash",
					cwd: feature,
					tool_input: { command: delayed },
				}),
				{
					supportsAsk: false,
					resolveBranches: (_segment, cwd) => ({
						currentBranch: cwd === feature ? "loop-topic" : "main",
						mainBranch: "main",
						targetRelation: "own",
					}),
				},
			);
			assert.equal(
				delayedResult.output?.hookSpecificOutput.permissionDecision,
				"deny",
			);
			if (shell.endsWith("zsh")) {
				git("reset", "--hard", original);
				const coproc = `coproc cd '${feature}'; wait; git commit --allow-empty -qm fixture`;
				const observed = spawnSync(shell, ["-f", "-c", coproc], {
					cwd: repo,
					env,
					encoding: "utf8",
					timeout: 10000,
				});
				assert.equal(observed.status, 0, observed.stderr);
				assert.notEqual(
					git("rev-parse", "HEAD"),
					original,
					"coprocess cd cannot move the parent out of main",
				);
				const protectedMain = runMainCommitGuard(
					JSON.stringify({
						tool_name: "Bash",
						cwd: repo,
						tool_input: { command: coproc },
					}),
					{
						supportsAsk: false,
						resolveBranches: (_segment, cwd) => ({
							currentBranch: cwd === feature ? "loop-topic" : "main",
							mainBranch: "main",
							targetRelation: "own",
						}),
					},
				);
				assert.equal(
					protectedMain.output?.hookSpecificOutput.permissionDecision,
					"deny",
				);
			}
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
}
