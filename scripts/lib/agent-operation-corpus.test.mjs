import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { AGENT_OPERATION_CORPUS } from "./agent-operation-corpus.mjs";
import { combineDecisions, decideOperation } from "./agent-operation-table.mjs";
import { readShell } from "./shell-commands.mjs";

function classify(example) {
	const command =
		example.payload.tool_input?.command ?? example.payload.tool_input?.cmd;
	const shell = command ? readShell(command) : undefined;
	return classifyAgentOperations(example.payload, { ...example.facts, shell });
}
function evaluate(classified) {
	return combineDecisions(
		classified.operations.map((operation) =>
			decideOperation({ ...classified, ...operation }),
		),
	);
}

for (const property of [1, 2]) {
	test(`property ${property}: ${property === 1 ? "normal" : "safety"} corpus has exact decisions`, async (t) => {
		const cases = AGENT_OPERATION_CORPUS.filter(
			({ expected }) => (expected === "allow") === (property === 1),
		);
		assert.ok(cases.length > 0);
		for (const example of cases)
			await t.test(example.id, () => {
				for (const step of example.steps ?? [example]) {
					const classified = classify(step);
					const diagnostic = `${step.id} [${classified.failure ?? "healthy"}]`;
					assert.equal(classified.subject, step.subject);
					assert.equal(
						evaluate(classified).decision,
						step.expected,
						diagnostic,
					);
					if (step.classes)
						assert.deepEqual(
							[
								...new Set(
									classified.operations.flatMap(({ classes }) => classes),
								),
							].sort(),
							[...step.classes].sort(),
							diagnostic,
						);
				}
			});
	});
}

test("property 7: execution uses explicit Git, remove and physical file targets independently of ownership", () => {
	const cases = AGENT_OPERATION_CORPUS.flatMap(
		(example) => example.steps ?? [example],
	).filter(({ target, executionPath }) => target || executionPath);
	assert.ok(cases.length >= 15);
	for (const example of cases) {
		const classified = classify(example);
		const diagnostic = `${example.id} [${classified.failure ?? "healthy"}]`;
		const operation = classified.operations.find(({ kind }) =>
			["git", "file"].includes(kind),
		);
		assert.ok(operation, diagnostic);
		if (example.target)
			assert.equal(operation.target, example.target, diagnostic);
		if (example.executionPath)
			assert.equal(operation.executionPath, example.executionPath, diagnostic);
	}
});

test("classification is deterministic and leaves injected facts and payload untouched", () => {
	const example = structuredClone(AGENT_OPERATION_CORPUS[0]);
	const before = structuredClone(example);
	assert.deepEqual(classify(example), classify(example));
	assert.deepEqual(example, before);
});
