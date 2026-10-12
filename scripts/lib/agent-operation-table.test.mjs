import assert from "node:assert/strict";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
import { run } from "./run-exec.mjs";
import { readShell } from "./shell-commands.mjs";
import {
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

test("Claude outward delegation returns to the parent except the publishing agent type", () => {
	for (const target of axes.target) {
		const cell = {
			subject: "claude-subagent",
			target,
			operationClass: "O",
			kind: "remote",
		};
		const blocked = decideOperation(cell);
		assert.equal(blocked.decision, "deny");
		assert.equal(blocked.recovery, "parent");
		assert.equal(
			decideOperation({ ...cell, agentType: "issue-worker" }).decision,
			"allow",
		);
		assert.equal(
			decideOperation({ ...cell, agentType: "reviewer" }).decision,
			"deny",
		);
		assert.equal(
			decideOperation({
				...cell,
				agentType: "issue-worker",
				classes: ["O", "P"],
			}).decision,
			"deny",
		);
	}
});

test("owner decision: W B C O deny on other worktrees for every subject", () => {
	for (const subject of axes.subject) {
		for (const target of ["other-live", "other-unowned"]) {
			for (const operationClass of ["W", "B", "C", "O"]) {
				assert.equal(
					decideOperation({
						subject,
						health: "healthy",
						target,
						operationClass,
						kind: "git",
						scope: "repository",
					}).decision,
					"deny",
					`${subject}/${target}/${operationClass}`,
				);
			}
		}
	}
});

test("owner decision: Claude parent asks only for own repository configuration", () => {
	for (const target of axes.target) {
		for (const operationClass of axes.operationClass) {
			const result = decideOperation({
				subject: "claude-parent",
				health: "healthy",
				target,
				operationClass,
				kind: "git",
				scope: "repository",
			});
			assert.equal(
				result.decision === "ask",
				target === "own" && operationClass === "C",
				`${target}/${operationClass}`,
			);
		}
	}
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
	const repairRoot = mkdtempSync(join(root, "node_modules/pfdsl-recovery-"));
	const facts = corpusFacts({ hookRoot: repairRoot });
	const payload = {
		tool_name: "Bash",
		cwd: facts.sessionRoot,
		tool_input: { command: "git status" },
	};
	try {
		const missing = readShell(payload.tool_input.command, {
			parserPath: shellParserPath(repairRoot),
		});
		assert.equal(missing.failure, "parser-missing");
		assert.equal(
			evaluate(classifyAgentOperations(payload, { ...facts, shell: missing }))
				.decision,
			"deny",
		);
		const repair = {
			...payload,
			tool_input: { command: parserRecoveryCommand(repairRoot) },
		};
		assert.equal(
			evaluate(classifyAgentOperations(repair, { ...facts, shell: missing }))
				.decision,
			"allow",
		);
		assert.equal(isShellParserInstalled(repairRoot), false);
		mkdirSync(join(repairRoot, "scripts/lib"), { recursive: true });
		for (const file of [
			"scripts/setup-shell-parser.mjs",
			"scripts/lib/shell-parser-tool.mjs",
			"scripts/lib/cli-entrypoint.mjs",
		])
			copyFileSync(join(root, file), join(repairRoot, file));
		// Execute the selected installer from another cwd. Only its download is
		// injected, using the actual pinned asset and the production checksum.
		const download = join(repairRoot, "download-fixture.mjs");
		writeFileSync(
			download,
			`import { readFileSync } from "node:fs";\nglobalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => readFileSync(${JSON.stringify(shellParserPath(root))}) });\n`,
		);
		run(
			process.execPath,
			[
				"--import",
				download,
				join(repairRoot, "scripts/setup-shell-parser.mjs"),
			],
			{ cwd: join(root, "scripts"), timeout: 5000 },
		);
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
