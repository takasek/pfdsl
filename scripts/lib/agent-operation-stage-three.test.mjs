import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { CORPUS_ROOTS, corpusFacts } from "./agent-operation-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

const { own, primary, live } = CORPUS_ROOTS;
function inspect(command, overrides = {}) {
	const payload = {
		tool_name: "Bash",
		cwd: own,
		tool_input: { command },
		...overrides.payload,
	};
	const facts = { ...corpusFacts(overrides.facts), shell: readShell(command) };
	return {
		classified: classifyAgentOperations(payload, facts),
		result: evaluateAgentOperationPolicy(payload, facts),
	};
}

test("properties 2 and 7: ordinary Git destinations and ref roles preserve safety", async (t) => {
	for (const [command, target, decision, classes] of [
		["git init /tmp/x", "scratch", "allow", ["W"]],
		["git clone https://example.invalid/r /tmp/b", "scratch", "allow", ["W"]],
		["git archive HEAD -o /tmp/x.tar", "scratch", "allow", ["W"]],
		["git bundle create /tmp/x.bundle HEAD", "scratch", "allow", ["W"]],
		[`git init ${primary}/x`, "primary", "deny", ["W"]],
		[
			`git clone https://example.invalid/r ${live}/x`,
			"other-live",
			"deny",
			["W"],
		],
		[`git archive HEAD --output=${primary}/x.tar`, "primary", "deny", ["W"]],
		[`git bundle create ${live}/x.bundle HEAD`, "other-live", "deny", ["W"]],
		["git pull origin main", "own", "allow", ["W"]],
		["git pull origin main:main", "own", "deny", ["D"]],
		["git symbolic-ref --short HEAD", "own", "allow", ["R"]],
		["git symbolic-ref HEAD refs/heads/main", "own", "deny", ["D"]],
		["git symbolic-ref HEAD refs/heads/feature", "own", "deny", ["U"]],
		["git reflog delete HEAD", "own", "deny", ["U"]],
		["git tag v1", "own", "allow", ["B"]],
		["git hash-object -w a.txt", "own", "allow", ["W"]],
	])
		await t.test(command, () => {
			const { classified, result } = inspect(command);
			assert.equal(result.decision, decision);
			assert.equal(classified.operations[0].target, target);
			assert.deepEqual(classified.operations[0].classes, classes);
		});
	assert.equal(
		inspect(`git -C ${own} commit-tree HEAD^{tree} -m x`, {
			payload: { agent_id: "child" },
			facts: { harness: "codex" },
		}).result.recovery,
		"parent",
	);
});
