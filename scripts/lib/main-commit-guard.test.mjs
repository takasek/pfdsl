import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateMainCommitGuard, isGitCommitCommand } from "./main-commit-guard.mjs";

function payload({ toolName = "Bash", command }) {
	return { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: { command } };
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

describe("evaluateMainCommitGuard", () => {
	it("ignores tools other than Bash", () => {
		const result = evaluateMainCommitGuard(
			{ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/x" } },
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a non-commit command on main", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git status" }), { currentBranch: "main" });
		assert.equal(result.decision, "allow");
	});

	it("allows a commit on a feature branch", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git commit -m 'x'" }), {
			currentBranch: "feature/x",
		});
		assert.equal(result.decision, "allow");
	});

	it("denies a commit on main", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git commit -m 'x'" }), { currentBranch: "main" });
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /main/);
	});

	it("respects a configured default branch other than main", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git commit -m 'x'" }), {
			currentBranch: "trunk",
			mainBranch: "trunk",
		});
		assert.equal(result.decision, "deny");
	});

	it("allows when currentBranch is unknown (detached HEAD, detection failure)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git commit -m 'x'" }), { currentBranch: undefined });
		assert.equal(result.decision, "allow");
	});
});
