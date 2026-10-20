import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { corpusFacts } from "./agent-operation-corpus.mjs";
import { collectAgentOperationEnvironment } from "./agent-operation-environment.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

test("real Git facts permit fast-forward and reject dirty, ahead and detached primary", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-primary-pull-"));
	const git = (...args) =>
		execFileSync("git", ["-C", root, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	try {
		git("init", "-b", "main");
		git("config", "user.name", "Test");
		git("config", "user.email", "test@example.invalid");
		git("commit", "--allow-empty", "-m", "base");
		git("remote", "add", "origin", root);
		git("fetch", "origin", "main:refs/remotes/origin/main");
		git("remote", "set-head", "origin", "main");
		git("branch", "--set-upstream-to=origin/main", "main");
		git("commit", "--allow-empty", "-m", "remote advance");
		git("fetch", "origin", "main:refs/remotes/origin/main");
		git("reset", "--hard", "HEAD~1");
		const command = `git -C ${root} pull --ff-only --no-autostash origin main`;
		const payload = {
			tool_name: "exec_command",
			cwd: root,
			session_id: "fixture",
			tool_input: { cmd: command },
		};
		const observe = () =>
			evaluateAgentOperationPolicy(
				payload,
				collectAgentOperationEnvironment(payload, {
					hookRoot: root,
					shell: readShell(command),
					environment: {},
				}),
			).decision;
		assert.equal(observe(), "allow");
		git("pull", "--ff-only", "--no-autostash", "origin", "main");
		assert.equal(git("rev-parse", "HEAD"), git("rev-parse", "origin/main"));
		writeFileSync(join(root, "untracked"), "keep");
		assert.equal(observe(), "deny");
		rmSync(join(root, "untracked"));
		git("commit", "--allow-empty", "-m", "local only");
		assert.equal(observe(), "deny");
		git("switch", "--detach");
		assert.equal(observe(), "deny");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function decision(command, ready = true, harness = "codex", child = false) {
	const facts = corpusFacts({ harness, shell: readShell(command) });
	facts.worktrees[0].primaryPullReady = ready;
	return evaluateAgentOperationPolicy(
		{
			tool_name: "Bash",
			cwd: "/fixture/own",
			session_id: "session",
			...(child ? { agent_id: "child" } : {}),
			tool_input: { command },
		},
		facts,
	).decision;
}

test("parents may fast-forward the verified clean primary with explicit origin and base", () => {
	for (const harness of ["codex", "claude"])
		assert.equal(
			decision(
				"git -C /fixture/repo pull --ff-only --no-autostash origin main",
				true,
				harness,
			),
			"allow",
		);
});

test("primary pull keeps its state and literal command boundaries", () => {
	const base = "git -C /fixture/repo pull";
	for (const suffix of [
		"origin main",
		"--ff-only origin main",
		"--rebase origin main",
		"--ff-only --no-autostash upstream main",
		"--ff-only --no-autostash origin topic",
		"--ff-only --no-autostash origin main:main",
		"--ff-only --no-autostash --autostash origin main",
		"--ff-only --no-autostash origin main extra",
	])
		assert.equal(decision(`${base} ${suffix}`), "deny", suffix);
	assert.equal(
		decision(`${base} --ff-only --no-autostash origin main`, false),
		"deny",
	);
	assert.equal(
		decision(
			"git -c pull.rebase=true -C /fixture/repo pull --ff-only --no-autostash origin main",
		),
		"deny",
	);
	assert.equal(
		decision(
			`${base} --ff-only --no-autostash origin main`,
			true,
			"codex",
			true,
		),
		"deny",
	);
	assert.equal(
		decision(
			`${base} --ff-only --no-autostash origin main`,
			true,
			"claude",
			true,
		),
		"deny",
	);
	for (const target of ["own", "live", "unowned"])
		assert.equal(
			decision(
				`git -C /fixture/${target} pull --ff-only --no-autostash origin main`,
			),
			target === "own" ? "allow" : "deny",
		);
});
