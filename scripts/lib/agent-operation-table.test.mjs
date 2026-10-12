import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AGENT_OPERATION_AXES,
	combineDecisions,
	decideOperation,
	parserRecoveryCommand,
} from "./agent-operation-table.mjs";

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
