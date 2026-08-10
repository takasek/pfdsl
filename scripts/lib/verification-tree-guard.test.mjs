import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	evaluateVerificationTreeGuard,
	findVerificationSegments,
} from "./verification-tree-guard.mjs";

const WORKTREE_ROOT = "/Users/m5/works/pfdsl/.claude/worktrees/some-branch";
const MAIN_ROOT = "/Users/m5/works/pfdsl";

function payload({ toolName = "Bash", command }) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { command },
	};
}

describe("findVerificationSegments", () => {
	it("finds a bare `make test`", () => {
		assert.deepEqual(findVerificationSegments("make test"), ["make test"]);
	});

	it("finds `make` targets starting with check or build", () => {
		assert.deepEqual(findVerificationSegments("make check-format"), [
			"make check-format",
		]);
		assert.deepEqual(findVerificationSegments("make build-cli"), [
			"make build-cli",
		]);
	});

	it("finds `node --test ...`", () => {
		assert.deepEqual(
			findVerificationSegments('node --test "scripts/*.test.mjs"'),
			['node --test "scripts/*.test.mjs"'],
		);
	});

	it("finds pnpm test/build in their common forms", () => {
		for (const command of [
			"pnpm test",
			"pnpm -r test",
			"pnpm -r build",
			"pnpm run test",
			"pnpm --filter x build",
		]) {
			assert.deepEqual(findVerificationSegments(command), [command], command);
		}
	});

	it("does not match `make -C <path> ...` (explicit cwd, no drift risk)", () => {
		assert.deepEqual(findVerificationSegments("make -C /some/path test"), []);
	});

	it("does not match `make --directory <path> ...` or `--directory=<path>`", () => {
		assert.deepEqual(
			findVerificationSegments("make --directory /some/path test"),
			[],
		);
		assert.deepEqual(
			findVerificationSegments("make --directory=/some/path test"),
			[],
		);
	});

	it("does not match `pnpm -C <path> ...`", () => {
		assert.deepEqual(findVerificationSegments("pnpm -C /some/path test"), []);
	});

	it("does not match unrelated commands", () => {
		for (const command of [
			"git status",
			"ls",
			"gh issue view 1",
			"node scripts/foo.mjs",
		]) {
			assert.deepEqual(findVerificationSegments(command), [], command);
		}
	});

	it("finds a verification segment inside a compound command", () => {
		assert.deepEqual(findVerificationSegments("cd x && make test"), [
			"make test",
		]);
	});

	it("returns an empty array for a non-string command", () => {
		assert.deepEqual(findVerificationSegments(undefined), []);
	});
});

describe("evaluateVerificationTreeGuard", () => {
	it("allows tools other than Bash", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ toolName: "Read", command: "make test" }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: true,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("allows when command is not a string", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: undefined }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: true,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("allows when roots could not be resolved", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: "make test" }),
			null,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows when cwd is inside a linked worktree (worktreeRoot !== mainRoot)", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: "make test" }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: true,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("asks when cwd is the main checkout, linked worktrees exist, and the command is `make test`", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: "make test" }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: true,
			},
		);
		assert.equal(result.decision, "ask");
		assert.ok(result.reason.includes(MAIN_ROOT));
	});

	it("asks for `node --test ...` under the same conditions", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: 'node --test "scripts/*.test.mjs"' }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: true,
			},
		);
		assert.equal(result.decision, "ask");
	});

	it("asks for `pnpm -r test` under the same conditions", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: "pnpm -r test" }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: true,
			},
		);
		assert.equal(result.decision, "ask");
	});

	it("allows `make -C <path> test` even from the main checkout (explicit cwd)", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: "make -C /some/path test" }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: true,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("allows from the main checkout when no linked worktrees exist at all", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: "make test" }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: false,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a non-verification command from the main checkout with linked worktrees", () => {
		const result = evaluateVerificationTreeGuard(
			payload({ command: "git status" }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
				hasLinkedWorktrees: true,
			},
		);
		assert.equal(result.decision, "allow");
	});
});
