import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	evaluateMainCommitGuard,
	isGitCommitCommand,
	resolveCommandCwd,
	runMainCommitGuard,
} from "./main-commit-guard.mjs";

function payload({ toolName = "Bash", command }) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { command },
	};
}

describe("isGitCommitCommand", () => {
	it("flags a bare commit", () => {
		assert.equal(isGitCommitCommand("git commit -m 'x'"), true);
	});

	it("flags a commit behind global git flags", () => {
		assert.equal(isGitCommitCommand("git -C /repo commit -m 'x'"), true);
	});

	it("flags a commit in a compound command", () => {
		assert.equal(isGitCommitCommand("git add -A && git commit -m 'x'"), true);
	});

	it("ignores read-only or unrelated git commands", () => {
		assert.equal(isGitCommitCommand("git status --short"), false);
		assert.equal(isGitCommitCommand("git log --oneline -5"), false);
		assert.equal(isGitCommitCommand("git add -A"), false);
	});

	it("does not flag the word commit inside a quoted string", () => {
		assert.equal(isGitCommitCommand('echo "git commit"'), false);
	});

	it("does not flag commit appearing as a flag value", () => {
		assert.equal(isGitCommitCommand("git log --grep commit"), false);
	});

	it("ignores a non-string command", () => {
		assert.equal(isGitCommitCommand(undefined), false);
	});
});

describe("resolveCommandCwd", () => {
	const HOOK_CWD = "/repo";

	it("keeps the hook's cwd for a plain commit", () => {
		assert.equal(resolveCommandCwd("git commit -m 'x'", HOOK_CWD), HOOK_CWD);
	});

	it("follows a leading cd into the tree the commit lands in (#751)", () => {
		assert.equal(
			resolveCommandCwd(
				"cd .claude/worktrees/w && git commit -m 'x'",
				HOOK_CWD,
			),
			"/repo/.claude/worktrees/w",
		);
	});

	it("follows an absolute cd", () => {
		assert.equal(
			resolveCommandCwd("cd /elsewhere/w && git commit -m 'x'", HOOK_CWD),
			"/elsewhere/w",
		);
	});

	it("reads git -C, which used to bypass the guard entirely (#751)", () => {
		assert.equal(
			resolveCommandCwd("git -C /elsewhere/w commit -m 'x'", HOOK_CWD),
			"/elsewhere/w",
		);
	});

	it("lets git -C win over an earlier cd, since git resolves last", () => {
		assert.equal(
			resolveCommandCwd("cd /a && git -C /b commit -m 'x'", HOOK_CWD),
			"/b",
		);
	});

	it("uses the cd in effect where the commit runs, not a later one", () => {
		assert.equal(
			resolveCommandCwd("cd /a && git commit -m 'x' && cd /b", HOOK_CWD),
			"/a",
		);
	});

	it("strips quotes around a cd path", () => {
		assert.equal(
			resolveCommandCwd("cd '/a b/w' && git commit -m 'x'", HOOK_CWD),
			"/a b/w",
		);
	});

	it("falls back to the hook cwd when the path is not statically known", () => {
		assert.equal(
			resolveCommandCwd("cd $WORKTREE && git commit -m 'x'", HOOK_CWD),
			HOOK_CWD,
		);
		assert.equal(
			resolveCommandCwd("cd ~/works/x && git commit -m 'x'", HOOK_CWD),
			HOOK_CWD,
		);
	});

	it("falls back for a bare cd, which means the home directory", () => {
		assert.equal(
			resolveCommandCwd("cd && git commit -m 'x'", HOOK_CWD),
			HOOK_CWD,
		);
	});

	it("ignores a cd inside a quoted string", () => {
		assert.equal(
			resolveCommandCwd("echo 'cd /a' && git commit -m 'x'", HOOK_CWD),
			HOOK_CWD,
		);
	});
});

describe("evaluateMainCommitGuard", () => {
	it("ignores tools other than Bash", () => {
		const result = evaluateMainCommitGuard(
			{
				hook_event_name: "PreToolUse",
				tool_name: "Read",
				tool_input: { file_path: "/tmp/x" },
			},
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a non-commit command on main", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git status" }), {
			currentBranch: "main",
		});
		assert.equal(result.decision, "allow");
	});

	it("allows a commit on a feature branch", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{
				currentBranch: "feature/x",
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("denies a commit on main", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /main/);
	});

	it("respects a configured default branch other than main", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{
				currentBranch: "trunk",
				mainBranch: "trunk",
			},
		);
		assert.equal(result.decision, "deny");
	});

	it("allows when currentBranch is unknown (detached HEAD, detection failure)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{ currentBranch: undefined },
		);
		assert.equal(result.decision, "allow");
	});
});

describe("runMainCommitGuard", () => {
	const commit = JSON.stringify(payload({ command: "git commit -m 'x'" }));

	it("denies a commit on the default branch", () => {
		const { shouldOutput, output } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "main", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("denies on a default branch that is not called main", () => {
		const { shouldOutput } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "trunk", mainBranch: "trunk" }),
		});
		assert.equal(shouldOutput, true);
	});

	it("allows a commit on a feature branch", () => {
		const { shouldOutput } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "topic", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, false);
	});

	it("never resolves branches for a command that is not a commit", () => {
		let called = false;
		const input = JSON.stringify(payload({ command: "git status" }));
		const { shouldOutput } = runMainCommitGuard(input, {
			resolveBranches: () => {
				called = true;
				return { currentBranch: "main", mainBranch: "main" };
			},
		});
		assert.equal(shouldOutput, false);
		assert.equal(called, false);
	});

	it("silently allows malformed stdin JSON", () => {
		assert.deepEqual(
			runMainCommitGuard("not json{{{", { resolveBranches: () => ({}) }),
			{
				shouldOutput: false,
			},
		);
	});
});
