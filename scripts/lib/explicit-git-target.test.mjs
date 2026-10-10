import assert from "node:assert/strict";
import { test } from "node:test";
import { runMainCommitGuard } from "./main-commit-guard.mjs";

function decision(command, options = {}) {
	const result = runMainCommitGuard(
		JSON.stringify({
			tool_name: "Bash",
			cwd: "/repo/topic",
			tool_input: { command },
		}),
		{
			resolveBranches: (_, cwd) => ({
				currentBranch: cwd === "/repo/main" ? "main" : "topic",
				mainBranch: "main",
				targetRelation: "own",
			}),
			supportsAsk: false,
			...options,
		},
	);
	return result.output?.hookSpecificOutput;
}

test("cwd changes require an explicit absolute Git target rather than shell interpretation", () => {
	for (const command of [
		"cd /repo/topic && git add file",
		"git add file; cd /repo/main",
		"(cd /repo/main); git add file",
		"if true; then cd /repo/topic; fi; git restore file",
		"cd /repo/main; git -C ../topic add file",
		"builtin -- cd /repo/main; git add file",
	]) {
		assert.equal(decision(command)?.permissionDecision, "deny", command);
		assert.match(
			decision(command).permissionDecisionReason,
			/git -C.*absolute/,
		);
	}
	assert.equal(
		decision("cd /repo/main; git -C /repo/topic add file"),
		undefined,
	);
	assert.equal(decision("git add file && git commit -m x"), undefined);
	assert.equal(
		decision("FOO+=x git -C /repo/main add file")?.permissionDecision,
		"deny",
	);
	assert.equal(decision("FOO+=x git -C /repo/topic add file"), undefined);
	assert.equal(decision("if true; then git add file; fi"), undefined);
	assert.equal(decision("cd /repo/main; git status"), undefined);
	assert.equal(
		decision("printf '%s' 'cd /repo/main'; git add file"),
		undefined,
	);
});

test("shell environment changes are not interpreted or recovered by unset", () => {
	for (const command of [
		"export GIT_DIR=/repo/main/.git; unset GIT_DIR; git add file",
		"readonly GIT_DIR=/repo/main/.git; unset GIT_DIR; git add file",
		"source setup.sh; git -C /repo/topic add file",
		"read name; git add file",
		"printf -v name x; git add file",
		"builtin -- source setup.sh; git add file",
		"GIT_DIR+=/repo/main/.git; git add file",
		"GIT_DIR+=/repo/main/.git git add file",
		"GIT_CONFIG_COUNT+=1 git fetch origin",
	]) {
		assert.equal(decision(command)?.permissionDecision, "deny", command);
	}
	assert.equal(
		decision("export GIT_DIR=/repo/main/.git; git status"),
		undefined,
	);
	assert.equal(decision("printf '%s' hello; git add file"), undefined);
	assert.equal(
		decision("unset GIT_DIR; git -C /repo/topic add file", {
			ambientGitTargetOverride: true,
		})?.permissionDecision,
		"deny",
	);
});
