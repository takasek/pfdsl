import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import {
	AGENT_OPERATION_CORPUS,
	corpusFacts,
} from "./agent-operation-corpus.mjs";
import {
	combineDecisions,
	decideOperation,
	parserRecoveryCommand,
} from "./agent-operation-table.mjs";
import { readShell } from "./shell-commands.mjs";
import {
	installShellParser,
	isShellParserInstalled,
	shellParserPath,
} from "./shell-parser-tool.mjs";

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
					assert.equal(classified.subject, step.subject);
					assert.equal(evaluate(classified).decision, step.expected, step.id);
					if (step.classes)
						assert.deepEqual(
							[
								...new Set(
									classified.operations.flatMap(({ classes }) => classes),
								),
							].sort(),
							[...step.classes].sort(),
							step.id,
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
		const operation = classified.operations.find(({ kind }) =>
			["git", "file"].includes(kind),
		);
		assert.ok(operation, example.id);
		if (example.target)
			assert.equal(operation.target, example.target, example.id);
		if (example.executionPath)
			assert.equal(operation.executionPath, example.executionPath, example.id);
	}
});

test("property 8: missing parser -> allowed repair -> healthy recheck -> normal operations allowed", async () => {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const facts = corpusFacts({ hookRoot: root });
	const payload = {
		tool_name: "Bash",
		cwd: facts.sessionRoot,
		tool_input: { command: "git status" },
	};
	const missing = readShell(payload.tool_input.command, {
		parserPath: join(root, "node_modules/.pfdsl-tools/missing-parser"),
	});
	assert.equal(missing.failure, "parser-missing");
	assert.equal(
		evaluate(classifyAgentOperations(payload, { ...facts, shell: missing }))
			.decision,
		"deny",
	);
	const repair = {
		...payload,
		tool_input: { command: parserRecoveryCommand(root) },
	};
	assert.equal(
		evaluate(classifyAgentOperations(repair, { ...facts, shell: missing }))
			.decision,
		"allow",
	);
	// Exercise verified installation into a missing location using the actual pinned bytes.
	const { mkdtempSync, rmSync } = await import("node:fs");
	const repairRoot = mkdtempSync(join(root, "node_modules/pfdsl-recovery-"));
	try {
		assert.equal(isShellParserInstalled(repairRoot), false);
		const bytes = readFileSync(shellParserPath(root));
		await installShellParser(repairRoot, {
			fetchAsset: async () => ({ ok: true, arrayBuffer: async () => bytes }),
		});
		assert.equal(isShellParserInstalled(repairRoot), true);
		for (const example of AGENT_OPERATION_CORPUS.filter(
			({ expected, health }) => expected === "allow" && health === "healthy",
		)) {
			for (const step of example.steps ?? [example]) {
				const command =
					step.payload.tool_input.command ?? step.payload.tool_input.cmd;
				const shell = command
					? readShell(command, { parserPath: shellParserPath(repairRoot) })
					: undefined;
				const classified = classifyAgentOperations(step.payload, {
					...step.facts,
					shell,
				});
				assert.equal(classified.health, "healthy", step.id);
				assert.equal(evaluate(classified).decision, "allow", step.id);
			}
		}
	} finally {
		rmSync(repairRoot, { recursive: true, force: true });
	}
});

test("classification is deterministic and leaves injected facts and payload untouched", () => {
	const example = structuredClone(AGENT_OPERATION_CORPUS[0]);
	const before = structuredClone(example);
	assert.deepEqual(classify(example), classify(example));
	assert.deepEqual(example, before);
});
