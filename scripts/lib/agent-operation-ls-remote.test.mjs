import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { corpusFacts } from "./agent-operation-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

function inspect(command) {
	const payload = {
		tool_name: "exec_command",
		cwd: "/fixture/own",
		tool_input: { cmd: command, workdir: "/fixture/own" },
	};
	const facts = corpusFacts({ harness: "codex", shell: readShell(command) });
	return {
		classified: classifyAgentOperations(payload, facts),
		result: evaluateAgentOperationPolicy(payload, facts),
	};
}

test("literal tag queries are read-only even against another worktree", () => {
	for (const target of ["own", "repo", "live", "unowned"]) {
		const { classified, result } = inspect(
			`git -C /fixture/${target} ls-remote --tags origin refs/tags/v0.2.0`,
		);
		assert.deepEqual(classified.operations[0].classes, ["R"], target);
		assert.equal(result.decision, "allow", target);
	}
});

test("tag queries retain unknown-option and mutation denials", () => {
	for (const command of [
		"git -C /fixture/own ls-remote --upload-pack=/tmp/program --tags origin",
		"git -C /fixture/own ls-remote --unknown --tags origin",
		"git -C /fixture/own push --tags origin",
		"git -C /fixture/own ls-remote --tags origin; git -C /fixture/repo add a",
		"git -C /fixture/own ls-remote --tags origin; git -C /fixture/live add a",
	]) {
		assert.equal(inspect(command).result.decision, "deny", command);
	}
	assert.equal(
		inspect("git ls-remote --heads origin").result.decision,
		"allow",
	);
});
