import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	classifyGitCommand,
	evaluateMainCommitGuard,
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

describe("classifyGitCommand", () => {
	it("denies subcommands that create new state on the branch", () => {
		for (const sub of ["commit", "add", "rm", "mv", "apply", "am"]) {
			assert.deepEqual(
				classifyGitCommand(`git ${sub} x`),
				{ subcommand: sub, decision: "deny" },
				sub,
			);
		}
	});

	it("asks for subcommands that destroy or restore existing state (#777)", () => {
		for (const sub of [
			"reset",
			"restore",
			"checkout",
			"switch",
			"stash",
			"clean",
			"merge",
			"rebase",
			"cherry-pick",
			"revert",
		]) {
			assert.deepEqual(
				classifyGitCommand(`git ${sub} x`),
				{ subcommand: sub, decision: "ask" },
				sub,
			);
		}
	});

	it("classifies a subcommand behind global git flags", () => {
		assert.deepEqual(classifyGitCommand("git -C /repo commit -m 'x'"), {
			subcommand: "commit",
			decision: "deny",
		});
	});

	it("prefers the denied subcommand over an asked one in a compound", () => {
		assert.deepEqual(classifyGitCommand("git checkout main && git add -A"), {
			subcommand: "add",
			decision: "deny",
		});
	});

	it("leaves read-only git commands alone", () => {
		assert.equal(classifyGitCommand("git status --short"), null);
		assert.equal(classifyGitCommand("git log --oneline -5"), null);
		assert.equal(classifyGitCommand("git fetch origin"), null);
		assert.equal(classifyGitCommand("git worktree add ../w -b topic"), null);
	});

	it("leaves the read-only stash forms alone, since they diagnose a loss", () => {
		assert.equal(classifyGitCommand("git stash list"), null);
		assert.equal(classifyGitCommand("git stash show -p"), null);
	});

	it("leaves the read-only apply forms alone, since they only report", () => {
		assert.equal(classifyGitCommand("git apply --check patch.diff"), null);
		assert.equal(classifyGitCommand("git apply --stat patch.diff"), null);
	});

	it("still denies an apply that writes", () => {
		assert.deepEqual(classifyGitCommand("git apply patch.diff"), {
			subcommand: "apply",
			decision: "deny",
		});
	});

	it("treats a bare `git stash` as the push it is", () => {
		assert.deepEqual(classifyGitCommand("git stash"), {
			subcommand: "stash",
			decision: "ask",
		});
	});

	it("does not classify a subcommand inside a quoted string", () => {
		assert.equal(classifyGitCommand('echo "git commit"'), null);
		assert.equal(classifyGitCommand("echo 'git add -A'"), null);
	});

	it("does not classify a subcommand appearing as a flag value", () => {
		assert.equal(classifyGitCommand("git log --grep commit"), null);
	});

	it("ignores a non-string command", () => {
		assert.equal(classifyGitCommand(undefined), null);
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

	it("resolves the tree for guarded subcommands other than commit (#777)", () => {
		assert.equal(resolveCommandCwd("cd /a && git add -A", HOOK_CWD), "/a");
		assert.equal(resolveCommandCwd("git -C /b stash push", HOOK_CWD), "/b");
	});

	it("stops at the first guarded subcommand, not a later one", () => {
		assert.equal(
			resolveCommandCwd(
				"cd /a && git add -A && cd /b && git commit -m 'x'",
				HOOK_CWD,
			),
			"/a",
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

	it("allows a read-only command on main", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git status" }), {
			currentBranch: "main",
		});
		assert.equal(result.decision, "allow");
	});

	it("denies staging on main, the index the whole repo shares (#777)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "main",
		});
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /git add/);
	});

	it("asks before a restore on main, which is also the recovery path (#777)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git checkout -- src/x.ts" }),
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /git checkout/);
	});

	it("allows staging on a feature branch", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "feature/x",
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

	it("asks rather than denies for a state-restoring subcommand (#777)", () => {
		const input = JSON.stringify(payload({ command: "git reset --hard" }));
		const { shouldOutput, output } = runMainCommitGuard(input, {
			resolveBranches: () => ({ currentBranch: "main", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
	});

	it("never resolves branches for a command the guard does not cover", () => {
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
