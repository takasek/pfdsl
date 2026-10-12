import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_OPERATION_LEGACY_CORPUS } from "./agent-operation-legacy-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

test("entry replay corpus retains every adopted legacy safety case with independent deny expectations", async (t) => {
	assert.equal(AGENT_OPERATION_LEGACY_CORPUS.length, 543);
	for (const example of AGENT_OPERATION_LEGACY_CORPUS)
		await t.test(example.id, () => {
			assert.equal(example.expected, "deny");
			const command = example.payload.tool_input?.command;
			const shell = command ? readShell(command) : undefined;
			const result = evaluateAgentOperationPolicy(example.payload, {
				...example.facts,
				shell,
			});
			assert.equal(
				result.decision,
				example.expected,
				`${example.source}: ${example.title}`,
			);
			assert.ok(result.reason);
			assert.ok(["rewrite", "parent", "terminal"].includes(result.recovery));
		});
});
