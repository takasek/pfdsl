import { parserRecoveryCommand } from "./agent-operation-table.mjs";

export const CORPUS_ROOTS = {
	primary: "/fixture/repo",
	own: "/fixture/own",
	live: "/fixture/live",
	unowned: "/fixture/unowned",
	foreign: "/fixture/foreign",
	trial: "/tmp/trial",
};
const { primary, own, live, unowned, foreign, trial } = CORPUS_ROOTS;
const commonDir = `${primary}/.git`;

export function corpusFacts(overrides = {}) {
	return {
		harness: "claude",
		health: "healthy",
		hookRoot: own,
		sessionRoot: own,
		sessionId: "session",
		commonDir,
		defaultBranch: "main",
		worktrees: [
			{ root: primary, commonDir, primary: true, branch: "main" },
			{ root: own, commonDir, branch: "feat/own" },
			{
				root: live,
				commonDir,
				branch: "feat/live",
				ownership: { ownerId: "other", live: true },
			},
			{ root: unowned, commonDir, branch: "feat/unowned" },
			{
				root: foreign,
				commonDir: `${foreign}/.git`,
				primary: true,
				branch: "main",
			},
			{ root: trial, commonDir, branch: null },
			{
				root: "/fixture/native",
				commonDir,
				branch: "feat/native",
				ownership: { ownerId: "session", live: true },
			},
		],
		branches: {
			main: { checkedOutAt: primary },
			"feat/merged": { merged: true },
			"feat/busy": { checkedOutAt: live },
		},
		physicalPaths: {
			[`${own}/primary-link/a`]: `${primary}/a`,
			[`${own}/live-link/a`]: `${live}/a`,
		},
		mcpTools: {
			mcp__github__get_pull_request: "R",
			mcp__github__create_pull_request: "O",
			mcp__github__merge_pull_request: "P",
		},
		...overrides,
	};
}

function example(
	id,
	command,
	expected = "allow",
	{
		subject = "claude-parent",
		agentType,
		cwd = own,
		facts = {},
		classes,
		target,
		executionPath,
		tool,
	} = {},
) {
	const environment = corpusFacts({
		harness: subject.startsWith("codex-") ? "codex" : "claude",
		...facts,
	});
	return {
		id,
		subject,
		health: environment.health,
		sessionRoot: environment.sessionRoot,
		execution: cwd,
		ownership: environment.worktrees.map(({ root, ownership }) => ({
			root,
			ownership,
		})),
		branchState: environment.worktrees.map(({ root, branch }) => ({
			root,
			branch,
		})),
		facts: environment,
		payload: {
			tool_name: tool?.name ?? "Bash",
			cwd,
			session_id: "session",
			...(subject.endsWith("child") || subject.endsWith("subagent")
				? { agent_id: "child" }
				: {}),
			...(agentType ? { agent_type: agentType } : {}),
			tool_input: tool?.input ?? { command },
		},
		expected,
		...(classes ? { classes } : {}),
		...(target ? { target } : {}),
		...(executionPath ? { executionPath } : {}),
	};
}

// Every row of the specification's acceptance pairs has a named normal case
// and, where present, its independently specified safety case.
export const AGENT_OPERATION_CORPUS = [
	example("relative-cd-with-CDPATH", "cd sibling && git add a", "deny", {
		facts: { cdPathOverride: true },
		target: "unresolved",
	}),
	example("dot-relative-cd-with-CDPATH", "cd ../own && git add a", "allow", {
		facts: { cdPathOverride: true },
	}),
	...[
		"gh label create x --description --help",
		"gh issue edit 1 --add-label --help",
		"gh pr edit 1 --add-reviewer --help",
		"gh release create v1 --notes --help",
		"gh repo create x -h --help",
		"gh repo create foo -h https://example.com --private",
		"gh auth logout -h github.com",
	].map((command, i) =>
		example(`outward-help-looking-value-${i}`, command, "deny", {
			subject: "claude-subagent",
		}),
	),
	example("merge-mode-with-standalone-help", "gh pr merge -m --help", "allow", {
		classes: ["R"],
	}),
	example("ordinary-env-own-Git", "env -i git commit -m x", "allow"),
	example("ordinary-env-primary-Git", "env -i git add a", "deny", {
		cwd: primary,
	}),
	example("ordinary-env-subagent-push", "env FOO=bar git push", "deny", {
		subject: "claude-subagent",
	}),
	example(
		"ordinary-sudo-other-Git",
		`sudo -u root git -C ${unowned} add a`,
		"deny",
	),
	example(
		"ordinary-time-other-Git",
		`time -o /tmp/time-output git -C ${unowned} add a`,
		"deny",
	),
	example(
		"unknown-wrapper-option",
		`sudo --unknown value git -C ${unowned} add a`,
		"deny",
	),
	example(
		"wrapper-string-remains-data",
		"sudo echo 'git commit --no-verify'",
		"allow",
	),
	example(
		"legacy-config-value-is-help-looking-data",
		"git config core.hooksPath --help",
		"deny",
		{ classes: ["C", "X"] },
	),
	example(
		"legacy-config-value-is-option-looking-data",
		"git config core.hooksPath --show-origin",
		"deny",
		{ classes: ["C", "X"] },
	),
	example(
		"pair-01-own-add-commit-push",
		"git add a && git commit -m x && git push -u origin HEAD",
	),
	...[
		"claude-parent",
		"claude-subagent",
		"codex-parent",
		"codex-child",
	].flatMap((subject) => [
		example(`pair-01-other-live-${subject}`, `git -C ${live} add a`, "deny", {
			subject,
			target: "other-live",
			executionPath: live,
		}),
		example(
			`pair-01-other-unowned-${subject}`,
			`git -C ${unowned} add a`,
			"deny",
			{ subject, target: "other-unowned", executionPath: unowned },
		),
	]),
	example("pair-02-leading-own-cd", `cd ${own} && git commit -m x`),
	example("pair-02-leading-live-cd", `cd ${live} && git commit -m x`, "deny", {
		target: "other-live",
	}),
	example("pair-03-codex-explicit-own", `git -C ${own} commit -m x`, "allow", {
		subject: "codex-parent",
	}),
	example("pair-03-codex-missing-C", "git commit -m x", "deny", {
		subject: "codex-parent",
		classes: ["U"],
	}),
	example(
		"pair-04-fetch-pr",
		"git fetch origin pull/1379/head:pr-1379",
		"allow",
		{ classes: ["B"] },
	),
	example("pair-04-fetch-default", "git fetch origin main:main", "deny", {
		classes: ["D"],
	}),
	example("pair-05-delete-merged", "git branch -D feat/merged", "allow", {
		classes: ["B"],
	}),
	example("pair-05-force-default", "git branch -f main HEAD", "deny", {
		classes: ["D"],
	}),
	example(
		"pair-05-update-default",
		"git update-ref refs/heads/main HEAD",
		"deny",
		{ classes: ["D"] },
	),
	example("pair-06-pr-create", "gh pr create", "allow", { classes: ["O"] }),
	example("pair-06-pr-view", "gh pr view", "allow", { classes: ["R"] }),
	example("pair-06-pr-merge", "gh pr merge 1413", "deny", {
		classes: ["O", "P"],
	}),
	...["git push -u origin HEAD", "gh pr create"].map((command, i) =>
		example(`claude-subagent-outward-${i}`, command, "deny", {
			subject: "claude-subagent",
			agentType: "reviewer",
			classes: ["O"],
		}),
	),
	example("claude-subagent-mcp-outward", null, "deny", {
		subject: "claude-subagent",
		agentType: "reviewer",
		classes: ["O"],
		tool: { name: "mcp__github__create_pull_request", input: {} },
	}),
	example("claude-issue-worker-outward", "gh pr create", "allow", {
		subject: "claude-subagent",
		agentType: "issue-worker",
		classes: ["O"],
	}),
	example("claude-issue-worker-still-no-merge", "gh pr merge 1413", "deny", {
		subject: "claude-subagent",
		agentType: "issue-worker",
		classes: ["O", "P"],
	}),
	example(
		"codex-issue-worker-still-returns-to-parent",
		"gh pr create",
		"deny",
		{
			subject: "codex-child",
			agentType: "issue-worker",
			classes: ["O"],
		},
	),
	example("pair-07-commit", "git commit -m x"),
	example("pair-07-bypass", "git commit --no-verify -m x", "deny", {
		classes: ["W", "X"],
	}),
	example(
		"pair-07-bypass-and-dynamic",
		"git commit --no-verify -m x; $cmd",
		"deny",
	),
	...[
		"git commit --no-verify -m x; repeat 2 echo x",
		"git commit --no-verify -m x; python <<'EOF'\nprint('x')\nEOF",
		"git commit --no-verify -m x; if then",
	].map((command, i) => example(`syntax-monotonic-${i}`, command, "deny")),
	example("pair-08-color-config", "git -c color.ui=never commit -m x"),
	example(
		"pair-08-hooks-config",
		"git -c core.hooksPath=/dev/null commit -m x",
		"deny",
		{ classes: ["W", "X"] },
	),
	example("pair-09-own-edit", null, "allow", {
		tool: {
			name: "Edit",
			input: { file_path: `${own}/a`, old_string: "a", new_string: "b" },
		},
	}),
	example("pair-09-primary-edit-started-primary", null, "deny", {
		cwd: primary,
		facts: { sessionRoot: primary },
		tool: { name: "Edit", input: { file_path: `${primary}/a` } },
		target: "primary",
	}),
	example("pair-10-primary-log", "git log", "allow", {
		cwd: primary,
		facts: { sessionRoot: primary },
	}),
	example("pair-10-primary-read", null, "allow", {
		tool: { name: "Read", input: { file_path: `${primary}/a` } },
	}),
	example("pair-10-primary-add", "git add a", "deny", { cwd: primary }),
	example("pair-10-primary-config", "git config user.name x", "deny", {
		cwd: primary,
	}),
	example("pair-10-primary-feature-add", "git add a", "deny", {
		cwd: primary,
		facts: {
			worktrees: corpusFacts().worktrees.map((tree) =>
				tree.root === primary ? { ...tree, branch: "feat/primary" } : tree,
			),
		},
	}),
	{
		...example("pair-11-add-remove-trial", null),
		steps: [
			example(
				"trial-add",
				"git worktree add --detach /tmp/trial origin/main",
				"allow",
				{ classes: ["B"] },
			),
			example("trial-read", `git -C ${trial} status`, "allow", {
				target: "other-unowned",
			}),
			example("trial-remove", `git worktree remove ${trial}`, "allow", {
				classes: ["W"],
				target: "other-unowned",
				executionPath: trial,
			}),
		],
	},
	example("pair-11-remove-live", `git worktree remove ${live}`, "deny", {
		target: "other-live",
		executionPath: live,
	}),
	example(
		"pair-11-force-remove-unowned",
		`git worktree remove --force ${unowned}`,
		"deny",
		{ target: "other-unowned" },
	),
	example("pair-12-child-absolute-patch", null, "allow", {
		subject: "codex-child",
		tool: {
			name: "apply_patch",
			input: {
				patch: `*** Begin Patch\n*** Add File: ${own}/a\n+a\n*** End Patch`,
			},
		},
	}),
	example("pair-12-child-git-add", `git -C ${own} add a`, "deny", {
		subject: "codex-child",
	}),
	example("pair-13-child-status", "git status", "allow", {
		subject: "codex-child",
	}),
	example("pair-13-child-edit", null, "allow", {
		subject: "codex-child",
		tool: { name: "Edit", input: { file_path: `${own}/a` } },
	}),
	example("pair-13-child-git-no-C", "git add a", "deny", {
		subject: "codex-child",
	}),
	example("pair-13-child-pr-create", "gh pr create", "deny", {
		subject: "codex-child",
	}),
	example("pair-14-gh-help", "gh help"),
	example("pair-14-merge-help", "gh pr merge --help", "allow", {
		classes: ["R"],
	}),
	example("pair-15-parser-repair", parserRecoveryCommand(own), "allow", {
		facts: { health: "failed", failure: "parser-missing" },
	}),
	example("pair-15-parser-missing-make-setup", "make setup", "deny", {
		facts: { health: "failed", failure: "parser-missing" },
	}),
	example("pair-15-parser-missing-commit", "git commit -m x", "deny", {
		facts: { health: "failed", failure: "parser-missing" },
	}),

	example(
		"transcript-stash-typecheck-pop",
		"git stash; make typecheck; git stash pop",
	),
	example(
		"transcript-detached-add",
		"git worktree add --detach /tmp/x origin/main",
		"allow",
		{ classes: ["B"] },
	),
	example("transcript-remove-x", "git worktree remove /tmp/x", "allow", {
		target: "scratch",
		executionPath: "/tmp/x",
	}),
	example(
		"worktree-add-force-feature",
		"git worktree add -B feat/new /tmp/new HEAD",
		"allow",
		{
			classes: ["B"],
		},
	),
	...["-b", "-B"].map((flag) =>
		example(
			`worktree-add-default-${flag}`,
			`git worktree add ${flag} main /tmp/new HEAD`,
			"deny",
			{
				facts: { branches: {} },
				classes: ["D"],
			},
		),
	),
	example(
		"worktree-remove-double-force-own",
		`git -C ${own} worktree remove -ff ${own}`,
		"allow",
		{
			classes: ["W"],
			target: "own",
		},
	),
	example(
		"worktree-remove-double-force-unowned",
		`git -C ${own} worktree remove -ff ${unowned}`,
		"deny",
		{
			classes: ["W"],
			target: "other-unowned",
		},
	),
	example(
		"transcript-while-add",
		'while read -r f; do git add "$f"; done < list',
	),
	example("transcript-help-api", "gh help api"),
	example("transcript-process-substitution", "diff <(git show HEAD:a) a"),
	example("transcript-arithmetic", "echo $((1+2)); git commit -m x"),
	example("transcript-pushd-popd", "pushd /tmp; ls; popd; git add a"),
	example(
		"codex-stdin-commit-message",
		`git -C ${own} commit -F - <<'EOF'\nmessage\nEOF`,
		"allow",
		{
			subject: "codex-parent",
			classes: ["W"],
		},
	),
	example(
		"codex-stdin-message-literal-example",
		`git -C ${own} -c color.ui=never commit -F - <<'EOF'\ngit commit --no-verify -m example\nEOF`,
		"allow",
		{
			subject: "codex-parent",
			classes: ["W"],
		},
	),

	example(
		"resolution-session-live-explicit-own",
		`git -C ${own} add a`,
		"allow",
		{ cwd: live, executionPath: own, target: "own" },
	),
	example("resolution-session-own-cwd-live", "git add a", "deny", {
		cwd: live,
		executionPath: live,
		target: "other-live",
	}),
	example(
		"resolution-primary-session-native-own",
		"git -C /fixture/native add a",
		"allow",
		{
			facts: { sessionRoot: primary },
			executionPath: "/fixture/native",
			target: "own",
		},
	),
	example(
		"resolution-native-does-not-promote-child",
		"git -C /fixture/native add a",
		"deny",
		{ subject: "codex-child", target: "own" },
	),
	example(
		"resolution-missing-session-id-unowned",
		`git -C ${unowned} add a`,
		"deny",
		{
			facts: { sessionId: undefined },
			target: "other-unowned",
		},
	),
	example(
		"resolution-empty-session-id-unowned",
		`git -C ${unowned} add a`,
		"deny",
		{
			facts: {
				sessionId: "",
				worktrees: corpusFacts().worktrees.map((tree) =>
					tree.root === unowned
						? { ...tree, ownership: { ownerId: "", live: false } }
						: tree,
				),
			},
			target: "other-unowned",
		},
	),
	example(
		"resolution-startup-own-without-session-id",
		`git -C ${own} add a`,
		"allow",
		{
			facts: { sessionId: undefined },
			target: "own",
		},
	),
	example(
		"resolution-leading-relative-cd",
		"cd ../own && git commit -m x",
		"allow",
		{ cwd: primary },
	),
	...[
		"cd /fixture/own; git add a",
		"cd /fixture/own || git add a",
		"(cd /fixture/own && git add a)",
		"if true; then cd /fixture/own && git add a; fi",
		'cd "$target" && git add a',
		'git -C "$target" add a',
	].map((command, i) =>
		example(`resolution-unresolved-${i}`, command, "deny", {
			target: "unresolved",
		}),
	),
	example("resolution-codex-relative-C", "git -C ../own add a", "deny", {
		subject: "codex-parent",
	}),
	example(
		"resolution-inherited-Git-target",
		`git -C ${own} commit -m x`,
		"deny",
		{
			facts: { gitTargetOverride: true },
			classes: ["U"],
			target: "unresolved",
		},
	),
	example("resolution-inherited-Git-read", "git status", "allow", {
		facts: { gitTargetOverride: true },
		classes: ["R"],
		target: "unresolved",
	}),
	example(
		"resolution-inline-Git-target",
		`GIT_DIR=/fixture/repo/.git git -C ${own} commit -m x`,
		"deny",
		{
			classes: ["U"],
			target: "unresolved",
		},
	),
	example(
		"resolution-unrelated-assignment",
		"FOO=bar git commit -m x",
		"allow",
		{
			classes: ["W"],
			target: "own",
		},
	),
	example("resolution-native-patch-command", null, "allow", {
		subject: "codex-child",
		tool: {
			name: "apply_patch",
			input: {
				command: `*** Begin Patch\n*** Add File: ${own}/a\n+a\n*** End Patch`,
			},
		},
		classes: ["W"],
		target: "own",
	}),
	...[
		`*** Begin Patch\n*** Delete File: ${own}/file-link\n*** End Patch`,
		`*** Begin Patch\n*** Update File: ${own}/file-link\n*** Move to: ${own}/moved\n@@\n-a\n+b\n*** End Patch`,
	].map((command, i) =>
		example(`resolution-patch-unlinks-own-symlink-${i}`, null, "allow", {
			subject: "codex-child",
			facts: {
				physicalPaths: { [`${own}/file-link`]: `${primary}/a` },
				physicalEntryPaths: { [`${own}/file-link`]: `${own}/file-link` },
			},
			tool: { name: "apply_patch", input: { command } },
			target: "own",
		}),
	),
	example("resolution-patch-updates-symlink-content", null, "deny", {
		facts: {
			physicalPaths: { [`${own}/file-link`]: `${primary}/a` },
			physicalEntryPaths: { [`${own}/file-link`]: `${own}/file-link` },
		},
		tool: {
			name: "apply_patch",
			input: {
				command: `*** Begin Patch\n*** Update File: ${own}/file-link\n@@\n-a\n+b\n*** End Patch`,
			},
		},
		target: "primary",
	}),
	...[
		"cd - && git add a",
		"cd /fixture/own && git status & git add a",
		"! cd /fixture/own && git add a",
		"cd /fixture/own && true; git add a",
	].map((command, i) =>
		example(`resolution-nonprefix-cd-${i}`, command, "deny", {
			cwd: live,
			target: "unresolved",
		}),
	),
	example("resolution-codex-workdir-is-not-evidence", "git add a", "deny", {
		subject: "codex-parent",
		tool: { name: "exec_command", input: { cmd: "git add a", workdir: own } },
	}),
	example("resolution-symlink-primary-write", null, "deny", {
		tool: {
			name: "Write",
			input: { file_path: `${own}/primary-link/a`, content: "a" },
		},
		target: "primary",
		executionPath: `${primary}/a`,
	}),
	example("resolution-symlink-live-write", null, "deny", {
		tool: {
			name: "Write",
			input: { file_path: `${own}/live-link/a`, content: "a" },
		},
		target: "other-live",
	}),
	example("resolution-physical-parent-after-symlink", null, "deny", {
		facts: { physicalPaths: { [`${own}/link/../a`]: `${primary}/a` } },
		tool: {
			name: "Write",
			input: { file_path: `${own}/link/../a`, content: "x" },
		},
		target: "primary",
		executionPath: `${primary}/a`,
	}),
	example(
		"resolution-Git-physical-parent-after-symlink",
		`git -C ${own}/link/.. add a`,
		"deny",
		{
			facts: { physicalPaths: { [`${own}/link/..`]: primary } },
			target: "primary",
			executionPath: primary,
		},
	),
	example("resolution-move-patch", null, "deny", {
		tool: {
			name: "apply_patch",
			input: {
				patch: `*** Begin Patch\n*** Update File: ${own}/a\n*** Move to: ${primary}/b\n@@\n-a\n+b\n*** End Patch`,
			},
		},
	}),
	example("resolution-codex-relative-patch", null, "deny", {
		subject: "codex-parent",
		tool: {
			name: "apply_patch",
			input: { patch: "*** Begin Patch\n*** Add File: a\n+a\n*** End Patch" },
		},
	}),
	example("resolution-child-git-metadata", null, "deny", {
		subject: "codex-child",
		tool: { name: "Write", input: { file_path: `${own}/.git`, content: "x" } },
	}),
	example("foreign-default-commit", `git -C ${foreign} commit -m x`, "allow", {
		subject: "codex-parent",
		target: "foreign",
	}),
	example(
		"foreign-bypass",
		`git -C ${foreign} commit --no-verify -m x`,
		"allow",
		{ subject: "codex-parent" },
	),
	example(
		"foreign-global-config",
		`git -C ${foreign} config --global user.name x`,
		"deny",
		{ subject: "codex-parent" },
	),
	example("own-repository-config", "git config user.name x", "ask"),
	example(
		"foreign-attached-config-file-write",
		`git -C ${foreign} config -f/tmp/config user.name x`,
		"deny",
		{
			classes: ["C", "X"],
		},
	),
	example(
		"attached-API-merge-method",
		"gh api -XPUT repos/o/r/pulls/1/merge",
		"deny",
		{
			classes: ["O", "P"],
		},
	),
	example("own-subagent-config", "git config user.name x", "deny", {
		subject: "claude-subagent",
	}),
	example("own-stash-clear", "git stash clear", "deny", { classes: ["S"] }),
	...["push", "pop", "apply", "drop"].map((verb) =>
		example(`own-stash-${verb}`, `git stash ${verb}`, "allow", {
			classes: ["W"],
		}),
	),
	example("own-default-switch", "git switch main", "deny", { classes: ["D"] }),
	example("own-free-switch", "git switch feat/merged", "allow", {
		classes: ["B"],
	}),
	example("branch-rename-own", `git -C ${own} branch -m feat/new`, "allow", {
		classes: ["B"],
	}),
	example("branch-rename-child", `git -C ${own} branch -m feat/new`, "deny", {
		subject: "codex-child",
		classes: ["B"],
	}),
	example("branch-rename-default", "git branch -m main feat/new", "deny", {
		classes: ["D"],
	}),
	example("branch-rename-current-default", "git branch -m feat/new", "deny", {
		facts: {
			worktrees: corpusFacts().worktrees.map((tree) =>
				tree.root === own ? { ...tree, branch: "main" } : tree,
			),
		},
		classes: ["D"],
	}),
	...[
		"git branch feat/new main",
		"git branch -f feat/new main",
		"git switch -c feat/new main",
		"git switch -C feat/new main",
		"git checkout -b feat/new main",
		"git update-ref refs/heads/feat/new main",
	].map((command, i) =>
		example(`branch-default-is-startpoint-${i}`, command, "allow", {
			classes: ["B"],
		}),
	),
	...[
		"git checkout -- main",
		"git checkout --detach main",
		"git switch --detach main",
	].map((command, i) =>
		example(`branch-default-is-read-source-${i}`, command, "allow", {
			classes: ["W"],
		}),
	),
	example("own-busy-branch-delete", "git branch -D feat/busy", "deny", {
		target: "other-live",
	}),
	example("own-default-commit", "git commit -m x", "deny", {
		facts: {
			worktrees: corpusFacts().worktrees.map((tree) =>
				tree.root === own ? { ...tree, branch: "main" } : tree,
			),
		},
		classes: ["D"],
	}),
	example("unknown-git-subcommand", "git future-write a", "deny", {
		classes: ["U"],
	}),
	example(
		"help-bypasses-no-operation",
		"git -c core.hooksPath=/dev/null commit --no-verify --help",
		"allow",
		{ classes: ["R"] },
	),
	example("help-token-is-message", "git commit -m --help", "allow", {
		classes: ["W"],
	}),
	example("gh-checkout-independent", "gh pr create", "allow", { cwd: primary }),
	example("gh-api-read", "gh api repos/o/r/pulls/1", "allow", {
		classes: ["R"],
	}),
	example(
		"gh-api-write",
		"gh api -X PATCH repos/o/r/issues/1 -f title=x",
		"allow",
		{ classes: ["O"] },
	),
	...[
		"gh api repos/o/r/pulls/1/merge",
		"gh api repos/o/r/pulls/1/merge --method GET",
		"gh api repos/o/r/pulls/1/merge --method GET -f foo=bar",
	].map((command, i) =>
		example(`gh-api-merge-status-read-${i}`, command, "allow", {
			classes: ["R"],
		}),
	),
	...[
		"gh api -X PUT 'repos/o/r/pulls/1/merge?foo=bar'",
		"gh api 'repos/o/r/pulls/1/merge?foo=bar' -f sha=x",
	].map((command, i) =>
		example(`gh-api-merge-query-write-${i}`, command, "deny", {
			classes: ["O", "P"],
		}),
	),
	example(
		"gh-api-last-method-write",
		"gh api --method GET -X PUT repos/o/r/pulls/1/merge",
		"deny",
		{
			classes: ["O", "P"],
		},
	),
	example(
		"gh-api-last-method-read",
		"gh api --method PUT -X GET repos/o/r/pulls/1/merge",
		"allow",
		{
			classes: ["R"],
		},
	),
	...["merge", "merge-async"].map((endpoint) =>
		example(
			`gh-api-${endpoint}`,
			`gh api -X PUT repos/o/r/pulls/1/${endpoint}`,
			"deny",
			{ classes: ["O", "P"] },
		),
	),
	...[
		"mergePullRequest",
		"enqueuePullRequest",
		"enablePullRequestAutoMerge",
	].map((mutation) =>
		example(
			`gh-graphql-${mutation}`,
			`gh api graphql -f query='mutation { ${mutation}(input: {pullRequestId: "id"}) { clientMutationId } }'`,
			"deny",
			{ classes: ["O", "P"] },
		),
	),
	example(
		"gh-graphql-query",
		"gh api graphql -f query='query { viewer { login } }'",
		"allow",
		{ classes: ["R"] },
	),
	example("mcp-write", null, "allow", {
		tool: { name: "mcp__github__create_pull_request", input: {} },
		classes: ["O"],
	}),
	example("mcp-child-write", null, "deny", {
		subject: "codex-child",
		tool: { name: "mcp__github__create_pull_request", input: {} },
	}),
	example("mcp-merge", null, "deny", {
		tool: { name: "mcp__github__merge_pull_request", input: {} },
		classes: ["O", "P"],
	}),
];
