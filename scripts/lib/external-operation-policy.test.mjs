import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDelegationGuard } from "./delegation-guard.mjs";

const evaluate = (name, input = {}, agent = null) =>
	evaluateDelegationGuard(
		{
			tool_name: name,
			tool_input: input,
			...(agent ? { agent_id: "child", agent_type: agent } : {}),
		},
		{ supportsAsk: false },
	);

test("Windows GitHub executable names retain merge and child boundaries", () => {
	assert.equal(
		evaluate("Bash", { command: "gh.exe pr merge 1" }).decision,
		"deny",
	);
	assert.equal(
		evaluate(
			"Bash",
			{
				command:
					'"C:/Program Files/GitHub CLI/GH.EXE" issue create --title x --body y',
			},
			"worker",
		).decision,
		"deny",
	);
	assert.equal(
		evaluate("Bash", { command: "GH.EXE issue ls" }, "worker").decision,
		"allow",
	);
	assert.equal(
		evaluate("Bash", { command: "git.exe add file" }, "worker").decision,
		"deny",
	);
});

test("REST merge status GET remains a read for parent and child", () => {
	for (const agent of [null, "worker"]) {
		for (const command of [
			"gh api repos/o/r/pulls/1/merge",
			"gh api -X GET repos/o/r/pulls/1/merge",
		]) {
			assert.equal(
				evaluate("Bash", { command }, agent).decision,
				"allow",
				command,
			);
		}
	}
});

test("an unresolved API option cluster does not exempt a merge", () => {
	assert.equal(
		evaluate("Bash", { command: "gh api repos/o/r/pulls/1/merge -iX PUT" })
			.decision,
		"deny",
	);
});

test("a known API value flag accepts its attached short value", () => {
	assert.equal(
		evaluate("Bash", { command: "gh api user -q.login" }, "worker").decision,
		"allow",
	);
});

for (const command of [
	"gh pr merge 1413",
	"gh -R takasek/pfdsl pr merge 1413 --auto",
	"/opt/homebrew/bin/gh pr merge 1413",
	"gh api -X PUT repos/o/r/pulls/1/merge",
	"gh api /graphql -f 'query=mutation { mergePullRequest(input:{pullRequestId:\"fixture\"}) {clientMutationId} }'",
	"gh api https://api.github.com/graphql -f 'query=mutation { mergePullRequest(input:{pullRequestId:\"fixture\"}) {clientMutationId} }'",
	"gh api https://ghe.example/api/graphql -f 'query=mutation { mergePullRequest(input:{pullRequestId:\"fixture\"}) {clientMutationId} }'",
	"gh api -X PUT 'repos/o/r/pulls/1/merge#fragment'",
	"gh api -X PUT 'https://api.github.com/repos/o/r/pulls/1/merge#fragment'",
	"gh api -h github.com -X PUT repos/o/r/pulls/1/merge",
	"gh api graphql -F query=@merge.graphql",
	"gh api graphql --field=query=@merge.graphql",
	"gh api graphql -Fquery=@merge.graphql",
	"gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
])
	test(`parent merge stops before execution: ${command}`, () =>
		assert.equal(evaluate("Bash", { command }).decision, "deny"));

test("a GHES GraphQL query retains the parent read and child POST boundaries", () => {
	const command =
		"gh api https://ghe.example/api/graphql -f 'query=query { viewer { login } }'";
	assert.equal(evaluate("Bash", { command }).decision, "allow");
	assert.equal(evaluate("Bash", { command }, "worker").decision, "deny");
});

// gh reads --help here as a flag's value, a positional, or as a flag it
// rejects, so the command still runs.
for (const command of [
	"gh pr merge 1 --body --help",
	"gh pr merge 1 -b --help",
	"gh pr merge 1 --subject --help",
	"gh pr merge 1 -t --help",
	"gh pr merge 1 -A --help",
	"gh pr merge 1 --author-email --help",
	"gh pr merge 1 -F --help",
	"gh pr merge 1 --match-head-commit --help",
	"gh pr merge 1 --repo --help",
	"gh pr merge 1 -sb --help",
	"gh pr merge 1 -- --help",
	"gh pr merge 1 --unknown-flag --help",
	"gh pr merge 1 --bod --help",
	"gh api repos/o/r/pulls/1/merge -X --help",
	"gh api repos/o/r/pulls/1/merge --method --help",
	"gh api repos/o/r/pulls/1/merge -X PUT --jq --help",
	"gh api repos/o/r/pulls/1/merge -X PUT -q --help",
	"gh api repos/o/r/pulls/1/merge -X PUT -H --help",
	"gh api repos/o/r/pulls/1/merge -X PUT -f --help",
	"gh api repos/o/r/pulls/1/merge -X PUT --input --help",
	"gh api repos/o/r/pulls/1/merge -X PUT -- --help",
	"gh api repos/o/r/pulls/1/merge -X PUT --unknown --help",
])
	test(`merge is not hidden by a --help that gh reads as data: ${command}`, () =>
		assert.equal(evaluate("Bash", { command }).decision, "deny"));

for (const command of [
	"gh pr merge --help",
	"gh pr merge 1 --help",
	"gh pr merge --help 1",
	"gh pr --help merge 1",
	"gh --help pr merge 1",
	"gh -R o/r pr merge 1 --help",
	"gh pr merge 1 -s --help",
	"gh pr merge 1 -sd --help",
	"gh pr merge 1 --squash --delete-branch=false --help",
	"gh pr merge 1 --body x --help",
	"gh pr merge 1 -b x --help",
	"gh pr merge 1 -bx --help",
	"gh pr merge 1 --body=x --help",
	"gh pr merge 1 -R o/r --help",
	"gh api repos/o/r/pulls/1/merge --help",
	"gh api 'repos/o/r/pulls/1/merge#fragment' --help",
	"gh api -X PUT repos/o/r/pulls/1/merge --help",
	"gh api repos/o/r/pulls/1/merge -X PUT --paginate --help",
	"gh api repos/o/r/pulls/1/merge --hostname=h.example -XPUT --help",
	"gh api --hostname h.example repos/o/r/pulls/1/merge --help",
	"gh api repos/o/r/pulls/1/merge -iX PUT --help",
])
	test(`a real help request is not a merge: ${command}`, () =>
		assert.equal(evaluate("Bash", { command }).decision, "allow"));

for (const name of [
	"mcp__github__merge_pull_request",
	"mcp__codex_apps__github_enable_auto_merge",
	"mcp__github__enable_pull_request_auto_merge",
])
	test(`MCP merge stops for parent and child: ${name}`, () => {
		assert.equal(evaluate(name).decision, "deny");
		assert.equal(evaluate(name, {}, "issue-worker").decision, "deny");
	});

for (const name of [
	"mcp__github__create_issue",
	"mcp__codex_apps__github_update_ref",
	"mcp__github__execute",
	"mcp__github__get_and_delete_issue",
])
	test(`delegated/unknown-actor MCP mutation stops: ${name}`, () => {
		assert.equal(evaluate(name, {}, "issue-worker").decision, "deny");
		assert.equal(evaluate(name).decision, "deny");
	});

for (const name of [
	"mcp__github__get_issue",
	"mcp__codex_apps__github_fetch_pr",
	"mcp__github__search_issues",
	"mcp__codex_apps__github_get_commit_combined_status",
	"mcp__codex_apps__github_get_pr_diff",
	"mcp__codex_apps__github_get_profile",
	"mcp__codex_apps__github_get_repo",
	"mcp__codex_apps__github_get_user_login",
	"mcp__codex_apps__github_search_branches",
	"mcp__codex_apps__github_search_commits",
	"mcp__codex_apps__github_list_pull_request_review_threads",
])
	test(`known read MCP remains usable: ${name}`, () =>
		assert.equal(evaluate(name, {}, "worker").decision, "allow"));

test("parent Bash writes and unrelated tools remain usable", () => {
	assert.equal(
		evaluate("Bash", { command: "gh pr create --title ok" }).decision,
		"allow",
	);
	assert.equal(evaluate("mcp__calendar__create_event").decision, "allow");
	assert.equal(
		evaluate("Bash", { command: "gh pr view 1413" }).decision,
		"allow",
	);
	assert.equal(
		evaluate("Bash", { command: "echo 'gh pr merge 1413'" }).decision,
		"allow",
	);
});

test("Codex children do not inherit the Claude publishing exception", () =>
	assert.equal(
		evaluate("Bash", { command: "git push origin topic" }, "issue-worker")
			.decision,
		"deny",
	));

for (const command of [
	"git add --dry-run file",
	"git commit -m test",
	"git branch new-topic",
	"git branch -v new-topic",
	"git branch -vv new-topic HEAD",
	"git branch '--format=%(refname)' new-topic",
	"git branch --sort refname new-topic",
	"git branch --column new-topic",
	"git branch --del other",
	"git branch -a --del other",
	"git remote set-url origin /repo/other",
	"git remote update",
	"git remote prune origin",
	"git remote set-head origin -a",
	"git -c include.path=/tmp/x fetch origin",
	"git --config-env=a.b=ENV branch new-topic",
	"git reflog expire --all",
	"git reflog delete 'HEAD@{1}'",
	"git reflog drop --all",
	"git tag newtag",
	"git tag -d v1",
	"git tag -a v1 -m message",
	"git tag -l -d v1",
	"git tag v1 HEAD",
	"git notes add -m message",
	"git reflog write refs/stash HEAD HEAD injected",
	"git branch --list -d other",
	"git branch --unknown-option",
	"git branch --abbrev 3",
	"git fetch origin",
	"git update-ref refs/heads/topic HEAD",
	"git worktree remove ../other",
	"git worktree add -- --help HEAD",
	"git worktree add -- -h HEAD",
	"git worktree add --lock --reason --help ../review HEAD",
	"git worktree add ../review --reason --help HEAD",
	"git worktree add -fbh ../review HEAD",
	"git config set advice.foo list",
	"git config set advice.foo --list",
	"git config advice.foo --get",
	"git config set advice.foo --help",
	"git config advice.foo --help",
	"git config --file --help advice.foo value",
	"git config --file --list advice.foo value",
	"git config -- --list value",
	"git config --get --add advice.foo value",
	"git config set --comment --help advice.foo value",
	"git config --local remote.origin.url --list",
	"git config unset advice.foo",
	"git config edit",
	"git config rename-section advice other",
	"git config remove-section advice",
	"git config --local get remote.origin.url",
	"git branch -a --set-upstream-to origin/topic topic",
	"git remote -v remove origin",
	"git remote --verbose add upstream https://example.test/repo",
])
	test(`Codex child Git metadata stays parent-owned: ${command}`, () =>
		assert.equal(evaluate("Bash", { command }, "worker").decision, "deny"));

for (const command of [
	"git status",
	"git diff",
	"git branch --show-current",
	"git stash list",
	"git worktree list",
	"git branch --all",
	"git branch -r",
	"git -c core.pager=cat log -1",
	"git grep one",
	"git blame file.txt",
	"git shortlog -sn HEAD",
	"git ls-remote origin",
	"git diff-tree -r HEAD",
	"git name-rev HEAD",
	"git check-ignore file.txt",
	"git -c color.ui=never grep one",
	"git version",
	"git -c color.ui=never branch --list",
	"git reflog",
	"git reflog show HEAD",
	"git tag",
	"git tag -l",
	"git tag -l 'v*'",
	"git tag -n",
	"git tag --contains HEAD",
	"git tag --sort -creatordate -l",
	"git notes",
	"git notes list",
	"git notes show HEAD",
	"git reflog HEAD",
	"git reflog refs/stash",
	"git reflog list",
	"git reflog -n 5",
	"git reflog exists refs/heads/main",
	"git branch",
	"git branch --list",
	"git branch -v",
	"git branch -vv",
	"git branch '--format=%(refname:short)'",
	"git branch --format '%(refname:short)'",
	"git branch --sort=refname",
	"git branch --sort refname",
	"git branch --sort -committerdate",
	"git branch --merged",
	"git branch --merged HEAD",
	"git branch --no-merged HEAD",
	"git branch --contains HEAD",
	"git branch --no-contains HEAD",
	"git branch --points-at HEAD",
	"git branch --list main",
	"git branch -a --color=always --no-column --omit-empty --abbrev=7",
	"git remote -v",
	"git config --get remote.origin.url",
	"git config get remote.origin.url",
	"git config get --local remote.origin.url",
	"git config list",
	"git config list --local",
	"git config --file config --get remote.origin.url",
	"git config -fconfig --get remote.origin.url",
	"git config --type bool --get advice.foo",
	"git config --help",
	"git config set --help",
	"git config set --local -h",
	"git config unset --local --help",
	"git config edit --local --help",
	"git config set --append --all --bool-or-str --no-local --help",
	"git config unset --no-value --help",
	"git config --local remote.origin.url",
	"git config remote.origin.url",
	"git worktree add --help",
	"git worktree add --lock --help",
	"git worktree add -d --help",
	"git worktree add --no-lock -h",
	"git worktree add --track -h",
	"git worktree add -fd -h",
	"git worktree add ../review -h",
	"git worktree add -fdh",
])
	test(`Codex child Git reads remain usable: ${command}`, () =>
		assert.equal(evaluate("Bash", { command }, "worker").decision, "allow"));

test("Claude may ask about merge and keeps its named publisher exception", () => {
	const parent = {
		tool_name: "Bash",
		tool_input: { command: "gh pr merge 1" },
	};
	assert.equal(
		evaluateDelegationGuard(parent, { supportsAsk: true }).decision,
		"ask",
	);
	assert.equal(
		evaluateDelegationGuard(
			{
				...parent,
				agent_id: "child",
				agent_type: "issue-worker",
				tool_input: { command: "git push" },
			},
			{ supportsAsk: true },
		).decision,
		"allow",
	);
});

test("Windows executable prefixes expose protected inner commands and normal reads", () => {
	for (const command of [
		"env.exe git.exe update-ref refs/heads/main HEAD",
		"ENV.EXE gh.exe pr merge 123",
		'"C:/Program Files/Git/usr/bin/env.exe" gh.exe pr merge 123',
		"sudo.exe git.exe update-ref refs/heads/main HEAD",
		"/usr/bin/time.exe git.exe update-ref refs/heads/main HEAD",
		"TIME.EXE gh.exe pr merge 123",
	])
		assert.equal(
			evaluate("Bash", { command }, "worker").decision,
			"deny",
			command,
		);
	assert.equal(
		evaluate("Bash", { command: "env.exe gh.exe pr merge 123" }).decision,
		"deny",
	);
	for (const command of [
		"env.exe git.exe status",
		"ENV.EXE gh.exe issue ls",
		"time.exe git.exe status",
	])
		assert.equal(
			evaluate("Bash", { command }, "worker").decision,
			"allow",
			command,
		);
});

test("asynchronous REST merge requires human approval while status remains readable", () => {
	for (const agent of [null, "worker"]) {
		assert.equal(
			evaluate(
				"Bash",
				{
					command:
						"gh api -X PUT repos/o/r/pulls/1/merge-async -f merge_action=direct_merge",
				},
				agent,
			).decision,
			"deny",
		);
		for (const command of [
			"gh api repos/o/r/pulls/1/merge-async/result-id",
			"gh api -X GET repos/o/r/pulls/1/merge-async/result-id",
		]) {
			assert.equal(
				evaluate("Bash", { command }, agent).decision,
				"allow",
				command,
			);
		}
	}
	assert.equal(
		evaluateDelegationGuard({
			tool_name: "Bash",
			tool_input: { command: "gh api -X PUT repos/o/r/pulls/1/merge-async" },
		}).decision,
		"ask",
	);
});
