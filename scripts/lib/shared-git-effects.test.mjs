import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runMainCommitGuard } from "./main-commit-guard.mjs";

function decision(
	command,
	relation = "own",
	mainBranch = "trunk",
	supportsAsk = false,
) {
	const result = runMainCommitGuard(
		JSON.stringify({
			tool_name: "Bash",
			cwd: "/repo/feature",
			tool_input: { command },
		}),
		{
			resolveBranches: () => ({
				currentBranch: "topic",
				mainBranch,
				targetRelation: relation,
			}),
			supportsAsk,
		},
	);
	return result.output?.hookSpecificOutput.permissionDecision ?? "allow";
}

for (const command of [
	"git branch -f trunk HEAD",
	"git branch trunk HEAD",
	"git branch -M topic trunk",
	"git branch -D trunk",
	"git update-ref refs/heads/trunk HEAD",
	"git update-ref HEAD HEAD",
	"git update-ref --stdin",
	"git symbolic-ref HEAD refs/heads/trunk",
	"git fetch origin HEAD:refs/heads/trunk",
	"git fetch --refmap=+refs/*:refs/* origin",
	"git fetch origin +refs/heads/*:refs/heads/*",
	"git fetch origin HEAD:trunk",
	"git worktree remove ../other",
	"git worktree add --detach ../review HEAD",
	"git worktree add ../review topic",
	"git worktree add ../review",
	"git worktree add -b new-topic ../review HEAD",
	"git worktree add -bnew-topic ../review HEAD",
	"git worktree add -B trunk ../other HEAD",
	"git worktree add -b trunk ../other HEAD",
	"git switch -C trunk HEAD",
	"git checkout -B trunk HEAD",
	"git checkout -Btrunk HEAD",
	"git switch -Ctrunk HEAD",
	"git switch -fCtrunk HEAD",
	"git checkout -qBtrunk HEAD",
	"git checkout -fBtrunk HEAD",
	"git switch --force-create=trunk HEAD",
	"git switch trunk",
	"git worktree move ../other ../renamed",
	"git worktree prune",
	"git worktree repair ../other",
	"git stash clear",
	"git stash drop",
])
	test(`protects shared effect: ${command}`, () => {
		assert.equal(decision(command), "deny");
		assert.equal(decision(command, "sibling"), "deny");
		assert.equal(decision(command, "unknown"), "deny");
		assert.equal(decision(command, "foreign"), "allow");
	});

for (const command of [
	"git branch",
	"git branch --list trunk",
	"git branch -a",
	"git branch new-topic HEAD",
	"git branch -m renamed-topic",
	"git branch -m topic renamed-topic",
	"git switch -c new-topic trunk",
	"git checkout trunk -- file",
	"git fetch git@github.com:o/r.git",
	"git symbolic-ref HEAD",
	"git symbolic-ref -q --short HEAD",
	"git fetch origin",
	"git fetch origin topic",
	"git fetch origin topic:refs/remotes/origin/topic",
	"git fetch --dry-run origin HEAD:trunk",
	"git worktree list",
	"git worktree add -h",
	"git worktree prune --dry-run",
	"git stash list",
	"git stash show",
	"echo 'git update-ref refs/heads/trunk HEAD'",
])
	test(`keeps read or isolated creation: ${command}`, () =>
		assert.equal(decision(command), "allow"));

test("protects effects behind cwd/prefixes and uses the resolved default name", () => {
	assert.equal(
		decision(
			"cd /repo/feature && env git -C . branch -f main HEAD",
			"own",
			"main",
		),
		"deny",
	);
	assert.equal(
		decision(
			"git branch new-topic HEAD && git update-ref refs/heads/trunk HEAD",
		),
		"deny",
	);
});

test("Claude asks for every worktree add form even from an owned feature", () => {
	for (const command of [
		"git worktree add --detach ../review HEAD",
		"git worktree add ../review topic",
		"git worktree add ../review",
		"git worktree add -b new-topic ../review HEAD",
		"git worktree add -bnew-topic ../review HEAD",
	]) {
		assert.equal(decision(command, "own", "trunk", true), "ask", command);
	}
});

test("isolated creation cannot waive a sibling executor's ownership check", () => {
	for (const command of [
		"git branch new-topic HEAD",
		"git worktree add -b new-topic ../new HEAD",
	]) {
		assert.equal(decision(command, "sibling"), "deny");
	}
});

test("Git accepts clustered force/create branch options", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-clustered-ref-"));
	const git = (...args) => {
		const result = spawnSync("git", ["-C", root, ...args], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	try {
		git("init", "-q", "-b", "main");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.test",
			"commit",
			"--allow-empty",
			"-qm",
			"one",
		);
		git("switch", "-c", "topic");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.test",
			"commit",
			"--allow-empty",
			"-qm",
			"two",
		);
		const topic = git("rev-parse", "HEAD");
		for (const args of [
			["switch", "-fCmain", "HEAD"],
			["checkout", "-qBmain", "HEAD"],
			["checkout", "-fBmain", "HEAD"],
		]) {
			git("switch", "topic");
			git(...args);
			assert.equal(git("branch", "--show-current"), "main");
			assert.equal(git("rev-parse", "refs/heads/main"), topic);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
