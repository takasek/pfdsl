import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateClosesCreateGuard } from "./closes-create-guard.mjs";
import { runCommandUsageGuard } from "./command-usage-guard.mjs";
import { evaluateDelegationGuard } from "./delegation-guard.mjs";
import { runMainCommitGuard } from "./main-commit-guard.mjs";
import { shellParseDecision } from "./shell-commands.mjs";
import { runVerificationTreeGuard } from "./verification-tree-guard.mjs";

const payload = (command) => ({
	tool_name: "Bash",
	cwd: "/fixture/topic",
	tool_input: { command },
});
const outputDecision = (result) =>
	result.output?.hookSpecificOutput?.permissionDecision ?? "allow";
const guards = {
	main: (command, supportsAsk) =>
		outputDecision(
			runMainCommitGuard(JSON.stringify(payload(command)), {
				supportsAsk,
				resolveBranches: () => ({
					currentBranch: "topic",
					mainBranch: "main",
					targetRelation: "own",
				}),
			}),
		),
	delegation: (command, supportsAsk) =>
		evaluateDelegationGuard(payload(command), { supportsAsk }).decision,
	closes: (command, supportsAsk) =>
		evaluateClosesCreateGuard(payload(command), {
			supportsAsk,
			getDefaultBranch: () => "main",
			readFile: () => {
				throw new Error("unexpected body read");
			},
		}).decision,
	verification: (command, supportsAsk) =>
		outputDecision(
			runVerificationTreeGuard(JSON.stringify(payload(command)), {
				supportsAsk,
				resolveRoots: () => null,
			}),
		),
	usage: (command, supportsAsk) =>
		outputDecision(
			runCommandUsageGuard(JSON.stringify(payload(command)), { supportsAsk }),
		),
};
for (const [name, decide] of Object.entries(guards)) {
	test(`${name} defers unknown shell syntax only when the host can ask`, () => {
		for (const command of [
			"repeat 1 git status",
			"if then",
			'command "$CMD" status',
		]) {
			assert.equal(decide(command, true), "ask", command);
			assert.equal(decide(command, false), "deny", command);
		}
		assert.equal(decide("git status", true), "allow");
		assert.equal(decide("git status", false), "allow");
	});
}
test("a missing parser remains a repairable infrastructure denial", () => {
	for (const supportsAsk of [true, false]) {
		const result = shellParseDecision("git status", {
			supportsAsk,
			parserPath: "/nonexistent/pfdsl-shfmt",
		});
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /parser is missing.*make setup/);
	}
});
test("invalid parser output is not a request to approve the command", () => {
	const scratch = mkdtempSync(join(tmpdir(), "pfdsl-parser-failure-"));
	const parserPath = join(scratch, "parser");
	try {
		for (const output of [
			"invalid-json",
			"null",
			"{}",
			'{"Type":"File","Stmts":42}',
		]) {
			writeFileSync(parserPath, `#!/bin/sh\nprintf '%s' '${output}'\n`, {
				mode: 0o700,
			});
			const result = shellParseDecision("git status", {
				supportsAsk: true,
				parserPath,
			});
			assert.equal(result?.decision, "deny", output);
			assert.match(result.reason, /Repair the parser/);
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
test("known forbidden Git changes still deny on Claude", () => {
	const result = runMainCommitGuard(
		JSON.stringify(payload("git commit -m x")),
		{
			supportsAsk: true,
			resolveBranches: () => ({
				currentBranch: "main",
				mainBranch: "main",
				targetRelation: "own",
			}),
		},
	);
	assert.equal(outputDecision(result), "deny");
});

test("unresolved mixed calls defer the whole request to human review", () => {
	for (const supportsAsk of [true, false]) {
		const expected = supportsAsk ? "ask" : "deny";
		assert.equal(
			guards.main("git commit --no-verify -m x; gh land 123", supportsAsk),
			expected,
		);
		assert.equal(
			evaluateDelegationGuard(
				{ ...payload("git push; gh land 123"), agent_type: "pfd-implementer" },
				{ supportsAsk },
			).decision,
			expected,
		);
	}
});

test("an unresolved Git path asks on Claude and denies on Codex", () => {
	for (const supportsAsk of [true, false]) {
		for (const command of [
			'git -C "$WORKTREE" add -A',
			'git -C "$WORKTREE" add -A; git commit --no-verify -m x',
		]) {
			assert.equal(
				guards.main(command, supportsAsk),
				supportsAsk ? "ask" : "deny",
			);
		}
	}
});

test("a dynamic config assignment is confirmed instead of interpreted", () => {
	const command = 'cfg=core.hooksPath=/tmp/no-hooks; git -c "$cfg" commit -m x';
	assert.equal(guards.main(command, true), "ask");
	assert.equal(guards.main(command, false), "deny");
});

test("unresolved Git effects defer the whole call on Claude", () => {
	for (const command of [
		'git switch "$BRANCH"',
		'git fetch origin "$REFSPEC"',
		'git push origin "$REFSPEC"',
		'git commit --no-verify -m x; git switch "$BRANCH"',
		'git switch "$BRANCH"; git commit --no-verify -m x',
	]) {
		assert.equal(guards.main(command, true), "ask", command);
		assert.equal(guards.main(command, false), "deny", command);
	}
});
