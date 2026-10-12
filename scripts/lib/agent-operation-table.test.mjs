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
	AGENT_OPERATION_AXES,
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

function evaluate(classified) {
	return combineDecisions(
		classified.operations.map((operation) =>
			decideOperation({ ...classified, ...operation }),
		),
	);
}

// The specification's axes are independent of the production table's rows.
const axes = {
	subject: ["claude-parent", "claude-subagent", "codex-parent", "codex-child"],
	health: ["healthy", "failed"],
	target: [
		"own",
		"primary",
		"other-live",
		"other-unowned",
		"foreign",
		"scratch",
		"unresolved",
	],
	operationClass: ["R", "W", "B", "D", "S", "C", "X", "O", "P", "U"],
	kind: ["file", "git", "remote"],
	scope: ["repository", "external"],
};
const cells = Object.entries(axes).reduce(
	(rows, [key, values]) =>
		rows.flatMap((row) => values.map((value) => ({ ...row, [key]: value }))),
	[{}],
);

test("the specified input axes have 3360 cells", () => {
	assert.deepEqual(AGENT_OPERATION_AXES, axes);
	assert.equal(cells.length, 3360);
});

test("values outside the finite axes throw, including empty or malformed class collections", () => {
	const base = {
		subject: "codex-parent",
		health: "healthy",
		target: "own",
		kind: "git",
		scope: "repository",
		operationClass: "X",
	};
	for (const classes of [[], null, "R", {}, ["unknown"], ["R", null]]) {
		assert.throws(() => decideOperation({ ...base, classes }), TypeError);
	}
	for (const key of Object.keys(axes)) {
		assert.throws(
			() => decideOperation({ ...base, [key]: "unknown" }),
			TypeError,
		);
		assert.throws(
			() => decideOperation({ ...base, [key]: "unknown", classes: ["R"] }),
			TypeError,
		);
	}
	assert.throws(
		() => decideOperation({ ...base, health: "failed", classes: [] }),
		TypeError,
	);
	assert.throws(() => decideOperation(null), TypeError);
});

test("property 3: Codex never returns ask in any cell", () => {
	for (const cell of cells) {
		const result = decideOperation(cell);
		if (cell.subject.startsWith("codex-"))
			assert.notEqual(result.decision, "ask", JSON.stringify(cell));
	}
});

test("property 4: every denied cell has a reason and a finite recovery destination", () => {
	for (const cell of cells) {
		const result = decideOperation(cell);
		assert.ok(["allow", "ask", "deny"].includes(result.decision));
		if (result.decision !== "allow") {
			assert.ok(result.reason?.length, JSON.stringify(cell));
			assert.ok(
				["rewrite", "parent", "terminal"].includes(result.recovery),
				JSON.stringify(cell),
			);
		}
	}
});

test("property 5: adding another operation or U never weakens a denied cell", () => {
	for (const cell of cells) {
		const denied = decideOperation(cell);
		if (denied.decision !== "deny") continue;
		for (const operationClass of axes.operationClass) {
			const extra = decideOperation({ ...cell, operationClass });
			for (const pair of [
				[denied, extra],
				[extra, denied],
			])
				assert.equal(
					combineDecisions(pair).decision,
					"deny",
					JSON.stringify(cell),
				);
			assert.equal(
				decideOperation({
					...cell,
					classes: [cell.operationClass, operationClass, "U"],
				}).decision,
				"deny",
				JSON.stringify(cell),
			);
		}
	}
});

test("property 6: ownership does not promote a Codex child above its parent in any cell", () => {
	const rank = { allow: 0, ask: 1, deny: 2 };
	for (const cell of cells) {
		const parent = decideOperation({ ...cell, subject: "codex-parent" });
		const child = decideOperation({ ...cell, subject: "codex-child" });
		assert.ok(
			rank[child.decision] >= rank[parent.decision],
			JSON.stringify(cell),
		);
	}
});

test("declarative rows and class precedence implement the bounded contract", () => {
	const base = {
		subject: "claude-parent",
		health: "healthy",
		target: "own",
		kind: "git",
		scope: "repository",
	};
	assert.equal(
		decideOperation({ ...base, operationClass: "C" }).decision,
		"ask",
	);
	for (const operationClass of ["P", "X", "D", "S"]) {
		assert.equal(
			decideOperation({ ...base, classes: ["O", operationClass] }).decision,
			"deny",
		);
		assert.equal(
			decideOperation({ ...base, classes: [operationClass, "O"] }).decision,
			"deny",
		);
	}
	assert.equal(
		decideOperation({ ...base, target: "foreign", operationClass: "X" })
			.decision,
		"allow",
	);
	assert.equal(
		decideOperation({
			...base,
			target: "foreign",
			scope: "external",
			operationClass: "X",
		}).decision,
		"deny",
	);
	assert.equal(
		decideOperation({
			...base,
			target: "primary",
			kind: "remote",
			operationClass: "O",
		}).decision,
		"allow",
	);
	assert.equal(
		decideOperation({
			...base,
			target: "other-unowned",
			operationClass: "W",
			action: "worktree-remove",
			force: false,
		}).decision,
		"allow",
	);
	assert.equal(
		decideOperation({
			...base,
			target: "other-unowned",
			operationClass: "W",
			action: "worktree-remove",
			force: true,
		}).decision,
		"deny",
	);
});

test("parser recovery is an exact fixed-root command and never bypasses policy failures", () => {
	const hookRoot = "/fixture/own";
	const command = parserRecoveryCommand(hookRoot);
	const base = {
		subject: "codex-parent",
		health: "failed",
		failure: "parser-missing",
		hookRoot,
		command,
		operationClass: "R",
		target: "own",
		kind: "git",
		scope: "repository",
	};
	assert.equal(decideOperation(base).decision, "allow");
	for (const change of [
		{ command: `${command}; git commit -m x` },
		{ failure: "policy" },
		{ command: "make setup" },
		{ hookRoot: "/fixture/other" },
	]) {
		assert.equal(decideOperation({ ...base, ...change }).decision, "deny");
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
