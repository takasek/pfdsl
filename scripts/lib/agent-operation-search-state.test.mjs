import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { corpusFacts } from "./agent-operation-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

function inspect(command, harness) {
	const payload = {
		tool_name: "Bash",
		cwd: "/fixture/own",
		tool_input: { command },
	};
	const facts = corpusFacts({ harness, shell: readShell(command) });
	return {
		classified: classifyAgentOperations(payload, facts),
		result: evaluateAgentOperationPolicy(payload, facts),
	};
}

test("issue searches with literal state filters are read-only in both harnesses", () => {
	for (const harness of ["claude", "codex"]) {
		for (const filter of ["--state open", "--state closed", "--state=open"]) {
			const command = `gh search issues --repo takasek/pfdsl ${filter} "guard" --json number --limit 1`;
			const { classified, result } = inspect(command, harness);
			assert.deepEqual(classified.operations[0].classes, ["R"], command);
			assert.equal(result.decision, "allow", command);
		}
	}
});

test("state support preserves missing-value, unknown-option and write denials", () => {
	for (const harness of ["claude", "codex"]) {
		for (const command of [
			"gh search issues guard --state",
			"gh search issues guard --state open --not-declared",
			"gh search issues guard --state open; git -C /fixture/live add a",
		]) {
			assert.equal(inspect(command, harness).result.decision, "deny", command);
		}
		assert.equal(
			inspect("gh search issues guard --repo takasek/pfdsl", harness).result
				.decision,
			"allow",
		);
	}
});
