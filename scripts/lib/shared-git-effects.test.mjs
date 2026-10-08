import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runMainCommitGuard } from "./main-commit-guard.mjs";
import { isReadOnlyGitBranch } from "./shared-git-effects.mjs";

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
	"git branch --del trunk",
	"git branch --forc trunk HEAD",
	"git branch --mov topic trunk",
	"git branch -q -m trunk",
	"git branch -q -m topic trunk",
	"git branch -qm topic trunk",
	"git branch -v --move topic trunk",
	"git branch -q -M topic new-topic",
	"git branch -q -mf topic new-topic",
	"git branch --cop topic trunk",
	"git branch --set-u=trunk",
	"git branch --unset-up",
	"git branch --edit-d",
	"git branch -v trunk",
	"git branch -vv trunk HEAD",
	"git branch '--format=%(refname)' trunk",
	"git branch --sort refname trunk",
	"git branch --column trunk",
	"git update-ref refs/heads/trunk HEAD",
	"git update-ref HEAD HEAD",
	"git update-ref --stdin",
	"git symbolic-ref HEAD refs/heads/trunk",
	"git fetch origin HEAD:refs/heads/trunk",
	"git fetch --refmap=+refs/*:refs/* origin",
	"git fetch origin +refs/heads/*:refs/heads/*",
	"git fetch origin HEAD:trunk",
	"git fetch -n origin HEAD:trunk",
	"git fetch --dry-run origin HEAD:trunk",
	"git fetch --dry-run --no-dry-run origin HEAD:trunk",
	"git fetch -o --dry-run origin HEAD:trunk",
	"git fetch -qn origin HEAD:trunk",
	"git fetch -u origin",
	"git rebase --update-refs trunk",
	"git rebase -i --update-refs trunk",
	"git rebase --update-r trunk",
	"git rebase --no-update-refs --update-refs trunk",
	"git rebase --update-refs --no-update-refs --update-refs trunk",
	"export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=a.b GIT_CONFIG_VALUE_0=c; git fetch origin",
	"export GIT_CONFIG_PARAMETERS=x && git fetch origin",
	"GIT_CONFIG_COUNT=1; export GIT_CONFIG_COUNT; git fetch origin",
	"GIT_CONFIG_COUNT=1; git fetch origin",
	"declare -x GIT_CONFIG_COUNT=1; git branch new-topic",
	"export GIT_CONFIG_GLOBAL=/tmp/inc.cfg; git pull origin",
	"git symbolic-ref --d refs/heads/alias",
	"git symbolic-ref --del refs/heads/alias",
	"git symbolic-ref --delete refs/heads/alias",
	"git symbolic-ref -d refs/heads/alias",
	"git push --receive-pack git-receive-pack . +HEAD:other",
	"git push --exec git-receive-pack ../primary +HEAD:other",
	"git push --repo x . +HEAD:other",
	"git push --rep x . +HEAD:other",
	"git push --repo=. HEAD:other",
	"git push --repo . HEAD:other",
	"git push -o opt ./x HEAD:other",
	"git push --force-with-lease . HEAD:other",
	"git push .. +HEAD:other",
	"git remote add origin2 /repo/other",
	"git remote add --mirror=fetch m /repo/other",
	"git remote rename origin renamed",
	"git remote remove origin",
	"git remote rm origin",
	"git remote set-url origin /repo/other",
	"git remote set-branches origin main",
	"git remote set-head origin -a",
	"git remote prune origin",
	"git remote update",
	"git remote -v add origin2 /repo/other",
	"git switch --detach --no-detach trunk",
	"git checkout --detach --no-detach trunk",
	"git switch -d --no-detach trunk",
	"git switch --detach --no-det trunk",
	"git switch --detach --det trunk",
	"git worktree prune -n --no-dry-run",
	"git worktree prune --dry-run --no-dry-run",
	"git -c remote.origin.fetch=+refs/heads/*:refs/heads/* fetch origin",
	"git -c include.path=/tmp/inc.cfg fetch origin",
	"git -c user.name=x branch new-topic",
	"git -c user.name=x commit -m message",
	"git --config-env=remote.origin.fetch=RS fetch origin",
	"git --config-env remote.origin.fetch=RS pull origin",
	"GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.fetch GIT_CONFIG_VALUE_0=x git fetch origin",
	"GIT_CONFIG_PARAMETERS=x git fetch origin",
	"env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=a.b GIT_CONFIG_VALUE_0=c git fetch origin",
	"GIT_CONFIG_COUNT=0 git fetch origin",
	"git branch --unknown-option new-topic",
	"git branch --recurse-submodules new-topic",
	"git branch -z new-topic HEAD",
	"git switch -C other",
	"git switch -C new-topic",
	"git checkout -B other HEAD",
	"git checkout -qB other",
	"git checkout -fBother",
	"git switch -qC other",
	"git switch --force-create other",
	"git switch --force-c new-topic trunk",
	"git checkout --force-create=other",
	"git reflog expire --expire=now --all",
	"git reflog expire --all",
	"git reflog delete 'refs/stash@{0}'",
	"git reflog drop --all",
	"git reflog write refs/stash HEAD HEAD injected",
	"git reflog write refs/heads/other HEAD HEAD x",
	"git reflog no-such-verb",
	"git push . HEAD:trunk",
	"git push . HEAD:other",
	"git push . +HEAD:refs/heads/other",
	"git push . :other",
	"git push -f . HEAD:other",
	"git push ../primary +HEAD:other",
	"git push /repo/other HEAD:other",
	"git push file:///repo/other HEAD:other",
	"git push ~/other HEAD:other",
	"git push . other",
	"git push . HEAD:refs/stash",
	"git pull --no-rebase origin main:other",
	"git pull origin HEAD:trunk",
	"git pull . topic:other",
	"git pull origin main:refs/heads/other",
	"git pull --no-rebase origin +refs/heads/*:refs/heads/*",
	"git fetch -u",
	"git fetch -qu origin",
	"git fetch -uq origin topic",
	"git fetch --update-head-ok origin",
	"git fetch --update-h origin",
	"git fetch --stdin origin",
	"git fetch --std origin",
	"git fetch --refm=+refs/heads/*:refs/heads/* origin",
	"git config remote.origin.fetch +refs/heads/*:refs/heads/*",
	"git config user.name someone",
	"git config --add x.y 1",
	"git config --ad x.y 1",
	"git config set x.y 1",
	"git config --unset x.y",
	"git config --unset-a x.y",
	"git worktree remove ../other",
	"git worktree add --detach ../review HEAD",
	"git worktree add -- -h HEAD",
	"git worktree add -- --help HEAD",
	"git worktree add --lock --reason --help ../review HEAD",
	"git worktree add ../review --reason --help HEAD",
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
	"git checkout trunk --",
	"git switch -- trunk",
	"git switch trunk --",
	"git switch TRUNK",
	"git checkout Trunk",
	"git switch -C TRUNK HEAD",
	"git switch -c refs/heads/TRUNK",
	"git branch TRUNK HEAD",
	"git branch -f TRUNK HEAD",
	"git branch -m TRUNK",
	"git branch -m topic Trunk",
	"git branch -M refs/heads/TRUNK",
	"git checkout --conflict merge trunk",
	"git checkout --conflict merge trunk --",
	"git switch --conflict merge trunk",
	"git switch --conflict merge trunk --",
	"git switch --conflict merge -- trunk",
	"git checkout -",
	"git switch -",
	"git switch -- -",
	"git checkout --force -",
	"git checkout @{-1}",
	"git switch @{-1}",
	"git switch --conflict merge @{-2}",
	"git switch --ignore-other-worktrees new-topic",
	"git checkout --ignore-other-worktrees new-topic",
	"git checkout --ignore-oth new-topic",
	"git switch --ignore-oth -c new-topic",
	"git switch --force-c=trunk HEAD",
	"git switch --force-c trunk HEAD",
	"git switch --cr=trunk HEAD",
	"git checkout --orp trunk",
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
	"git branch --merged HEAD trunk",
	"git branch --contains HEAD",
	"git branch --sort -committerdate",
	"git branch --format '%(refname)'",
	"git branch -vv",
	"git branch -v new-topic",
	"git branch '--form=%(refname)'",
	"git branch -a",
	"git branch new-topic HEAD",
	"git branch -m renamed-topic",
	"git branch -m topic renamed-topic",
	"git branch -q -m renamed-topic",
	"git branch -q -m topic renamed-topic",
	"git branch -qm renamed-topic",
	"git branch -v --move renamed-topic",
	"git branch --abbrev",
	"git switch -c new-topic trunk",
	"git checkout trunk -- file",
	"git checkout -- file",
	"git switch --detach trunk",
	"git switch -d trunk",
	"git checkout --conflict merge new-topic",
	"git checkout --detach -",
	"git checkout - -- file",
	"git checkout --detach trunk",
	"git checkout --force new-topic",
	"git checkout --force -b new-topic",
	"git fetch git@github.com:o/r.git",
	"git symbolic-ref HEAD",
	"git symbolic-ref -q --short HEAD",
	"git fetch origin",
	"git fetch origin topic",
	"git fetch origin topic:refs/remotes/origin/topic",
	"git fetch -n origin",
	"git fetch -q origin",
	"git rebase trunk",
	"git rebase -i trunk",
	"git rebase --update-refs --no-update-refs trunk",
	"git rebase --update-refs --no-update-r trunk",
	"export GIT_CONFIG_COUNT=1; git status",
	"export GIT_CONFIG_COUNT=1; unset GIT_CONFIG_COUNT; git fetch origin",
	"export OTHER_VARIABLE=1; git fetch origin",
	"git symbolic-ref --short HEAD",
	"git symbolic-ref --quiet HEAD",
	"git push --receive-pack git-receive-pack origin topic",
	"git push --repo x origin topic",
	"git push .",
	"git push ../other",
	"git push -o opt origin HEAD:other",
	"git remote",
	"git remote -v",
	"git remote --verbose",
	"git remote show origin",
	"git remote -v show origin",
	"git remote get-url origin",
	"git switch --no-detach --detach trunk",
	"git checkout --no-detach --detach trunk",
	"git worktree prune --no-dry-run --dry-run",
	"git -c core.pager=cat log -1",
	"git -c color.ui=never grep one",
	"git -c color.ui=never blame file.txt",
	"git -c color.ui=never shortlog -sn HEAD",
	"git -c color.ui=never ls-remote origin",
	"git -c color.ui=never diff-tree -r HEAD",
	"git -c color.ui=never name-rev HEAD",
	"git -c color.ui=never check-ignore file.txt",
	"git -c color.ui=never status",
	"git -c k=v diff",
	"git -c k=v branch --list",
	"git -c k=v config --get user.name",
	"git -c k=v show-ref",
	"git --config-env=k=V rev-parse HEAD",
	"GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=a.b GIT_CONFIG_VALUE_0=c git status",
	"GIT_CONFIG_GLOBAL=/dev/null git log -1",
	"git branch --track new-topic origin/main",
	"git branch --quiet new-topic",
	"git branch --create-reflog new-topic",
	"git branch --no-create-reflog new-topic HEAD",
	"git branch --verbose --quiet new-topic",
	"git branch -t new-topic origin/main",
	"git branch --no-track new-topic",
	"git branch --track=direct new-topic origin/main",
	"git branch -q new-topic",
	"git branch -v new-topic",
	"git branch --unknown-option",
	"git checkout -b new-topic",
	"git checkout -qb new-topic",
	"git switch --create new-topic",
	"git switch --orphan new-topic",
	"git switch -qc new-topic trunk",
	"git reflog",
	"git reflog show",
	"git reflog show HEAD",
	"git reflog list",
	"git reflog -n 5",
	"git reflog --all",
	"git reflog exists refs/heads/main",
	"git push origin topic",
	"git push -u origin topic",
	"git push origin HEAD:other",
	"git push . HEAD:refs/tags/v1",
	"git push . HEAD:refs/remotes/origin/x",
	"git push",
	"git pull",
	"git pull --no-rebase origin",
	"git pull origin main",
	"git pull origin main:refs/remotes/origin/main",
	"git fetch -f origin topic",
	"git config --get user.name",
	"git config user.name",
	"git config --list",
	"git config get user.name",
	"git config --help",
	"git worktree list",
	"git worktree add -h",
	"git worktree add --help",
	"git worktree add --lock --help",
	"git worktree add -d --help",
	"git worktree add --no-lock -h",
	"git worktree add --track -h",
	"git worktree add ../review -h",
	"git worktree add -fdh",
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

test("a config write cannot be told apart from the plain fetch it arms", () => {
	// Once remote.origin.fetch maps a remote branch onto a local one, the plain
	// fetch has the effect of --refmap and looks harmless, so the write stops.
	const write =
		"git config remote.origin.fetch +refs/heads/main:refs/heads/main";
	assert.equal(decision("git fetch origin"), "allow");
	assert.notEqual(decision(write), "allow");
	assert.notEqual(decision(write, "own", "main", true), "allow");
	assert.equal(decision(write, "foreign", "main"), "allow");
});

test("Claude asks for every worktree add form even from an owned feature", () => {
	for (const command of [
		"git worktree add --detach ../review HEAD",
		"git worktree add -- -h HEAD",
		"git worktree add -- --help HEAD",
		"git worktree add --lock --reason --help ../review HEAD",
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

test("isReadOnlyGitBranch accepts only list mode with known read options", () => {
	for (const args of [
		[],
		["--list"],
		["-l", "main"],
		["-avv"],
		["--show-current"],
		["--format", "%(refname)"],
		["--sort", "-committerdate"],
		["--merged"],
		["--merged", "HEAD", "topic"],
		["--abbrev"],
		["--quiet"],
		["--contains", "HEAD"],
		["--color=always", "--no-column", "--abbrev=7", "--omit-empty", "-i"],
	])
		assert.equal(isReadOnlyGitBranch(args), true, args.join(" "));
	for (const args of [
		["-v", "newb"],
		["--format=x", "newb"],
		["--sort", "refname", "newb"],
		["--column", "newb"],
		["--del", "other"],
		["--list", "-d", "other"],
		["--merged", "HEAD", "--set-u=main"],
		["--abbrev", "3"],
		["--track"],
		["--create-reflog"],
		["--no-create-reflog", "newb"],
		["--unknown"],
		["-m", "topic", "renamed"],
		["-f"],
		["--", "newb"],
	])
		assert.equal(isReadOnlyGitBranch(args), false, args.join(" "));
});
