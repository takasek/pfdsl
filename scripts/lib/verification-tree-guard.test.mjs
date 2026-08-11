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

	it("finds any `make` target, not just test/check/build (#840 gap: `make format`)", () => {
		for (const command of [
			"make check-format",
			"make build-cli",
			"make format",
		]) {
			assert.deepEqual(findVerificationSegments(command), [command], command);
		}
	});

	it("finds a bare `make` with no target", () => {
		assert.deepEqual(findVerificationSegments("make"), ["make"]);
	});

	it("finds `node --test ...`", () => {
		assert.deepEqual(
			findVerificationSegments('node --test "scripts/*.test.mjs"'),
			['node --test "scripts/*.test.mjs"'],
		);
	});

	it("finds a bare `node --test` with no operand", () => {
		assert.deepEqual(findVerificationSegments("node --test"), ["node --test"]);
	});

	it("finds `node <relative script path>` even without --test (#840 gap: check-md-linebreaks.mjs)", () => {
		for (const command of [
			"node scripts/foo.mjs",
			"node scripts/check-md-linebreaks.mjs",
			"node ./scripts/foo.js",
			"node lib/foo.cjs",
			"node scripts/gen.ts",
			"node some/dir/entrypoint",
		]) {
			assert.deepEqual(findVerificationSegments(command), [command], command);
		}
	});

	it("does not match `node <absolute script path>` (explicit path, no drift risk)", () => {
		assert.deepEqual(findVerificationSegments("node /abs/scripts/foo.mjs"), []);
	});

	it("does not match `node --test <absolute script path>` (explicit path overrides --test)", () => {
		assert.deepEqual(
			findVerificationSegments("node --test /abs/scripts/foo.test.mjs"),
			[],
		);
	});

	it("does not match `node -e '...'` (no path operand)", () => {
		assert.deepEqual(findVerificationSegments("node -e '1+1'"), []);
	});

	it("does not match `node --input-type=module -e '...'` (no path operand)", () => {
		assert.deepEqual(
			findVerificationSegments("node --input-type=module -e '1+1'"),
			[],
		);
	});

	it("does not match an eval body that merely contains `/` chars — the body is program source, not a path (false-positive fix)", () => {
		for (const command of [
			'node -e "console.log(1)"',
			`node -e "import x from '/abs/path/x.mjs'"`,
			`node --input-type=module -e "import { checkFile } from '/Users/m5/works/pfdsl/scripts/lib/md-linebreaks.mjs';"`,
		]) {
			assert.deepEqual(findVerificationSegments(command), [], command);
		}
	});

	it("still matches a real relative script path, and still excludes a real absolute one (eval-flag fix must not widen or narrow those)", () => {
		assert.deepEqual(findVerificationSegments("node scripts/x.mjs"), [
			"node scripts/x.mjs",
		]);
		assert.deepEqual(findVerificationSegments("node /abs/scripts/x.mjs"), []);
	});

	it("finds pnpm/npm subcommands generally, not just test/build (#840 gap widening)", () => {
		for (const command of [
			"pnpm test",
			"pnpm -r test",
			"pnpm -r build",
			"pnpm run test",
			"pnpm --filter x build",
			"pnpm install",
			"pnpm biome check",
			"npm install",
			"npm run build",
		]) {
			assert.deepEqual(findVerificationSegments(command), [command], command);
		}
	});

	it("always finds npx (resolves from cwd's node_modules, no explicit-cwd escape)", () => {
		assert.deepEqual(findVerificationSegments("npx biome check"), [
			"npx biome check",
		]);
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

	it("does not match `pnpm -C <path> ...`, `--dir <path>`, or `--prefix=<path>`", () => {
		assert.deepEqual(findVerificationSegments("pnpm -C /some/path test"), []);
		assert.deepEqual(
			findVerificationSegments("pnpm --dir /some/path test"),
			[],
		);
		assert.deepEqual(
			findVerificationSegments("pnpm --prefix=/some/path test"),
			[],
		);
	});

	it("does not match `npm --prefix <path> ...`", () => {
		assert.deepEqual(
			findVerificationSegments("npm --prefix /some/path test"),
			[],
		);
	});

	it("does not match unrelated commands", () => {
		for (const command of ["git status", "ls", "gh issue view 1"]) {
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
