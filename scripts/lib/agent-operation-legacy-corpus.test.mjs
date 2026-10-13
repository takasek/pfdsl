import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AGENT_OPERATION_LEGACY_CORPUS } from "./agent-operation-legacy-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

function sorted(value) {
	return Array.isArray(value)
		? value.map(sorted)
		: value && typeof value === "object"
			? Object.fromEntries(
					Object.entries(value)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([key, item]) => [key, sorted(item)]),
				)
			: value;
}
test("legacy representation retains the pre-compaction count, expectations and full semantic content", () => {
	const before = JSON.parse(
		readFileSync(
			new URL(
				"./__fixtures__/agent-operation-legacy-snapshot.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const sha256 = (value) =>
		createHash("sha256")
			.update(JSON.stringify(sorted(value)))
			.digest("hex");
	assert.equal(AGENT_OPERATION_LEGACY_CORPUS.length, before.count);
	assert.equal(
		sha256(
			AGENT_OPERATION_LEGACY_CORPUS.map(({ id, expected }) => ({
				id,
				expected,
			})),
		),
		before.expectedSha256,
	);
	assert.equal(sha256(AGENT_OPERATION_LEGACY_CORPUS), before.contentSha256);
});

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
