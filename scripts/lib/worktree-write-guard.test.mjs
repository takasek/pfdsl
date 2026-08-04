import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateWorktreeWriteGuard } from "./worktree-write-guard.mjs";

const WORKTREE_ROOT = "/Users/m5/works/pfdsl/.claude/worktrees/some-branch";
const MAIN_ROOT = "/Users/m5/works/pfdsl";

function payload({ toolName = "Write", filePath }) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { file_path: filePath },
	};
}

describe("evaluateWorktreeWriteGuard", () => {
	it("ignores tools other than Edit/Write", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ toolName: "Read", filePath: `${MAIN_ROOT}/CLAUDE.md` }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("allows when git could not resolve the roots (not a git repo, git failure)", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: `${MAIN_ROOT}/CLAUDE.md` }),
			null,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows when the session is not inside a worktree at all (worktreeRoot === mainRoot)", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: `${MAIN_ROOT}/CLAUDE.md` }),
			{
				worktreeRoot: MAIN_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a write that stays inside the current worktree", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: `${WORKTREE_ROOT}/scripts/lib/foo.mjs` }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a write to the worktree root itself", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: WORKTREE_ROOT }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("denies a write into the main repo tree while cwd is inside a worktree (#357)", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: `${MAIN_ROOT}/CLAUDE.md` }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /worktree/i);
	});

	it("denies a write into a sibling worktree", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({
				filePath: `${MAIN_ROOT}/.claude/worktrees/other-branch/CLAUDE.md`,
			}),
			{ worktreeRoot: WORKTREE_ROOT, mainRoot: MAIN_ROOT },
		);
		assert.equal(result.decision, "deny");
	});

	it("allows a write entirely outside the repo tree (scratch files)", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: "/tmp/scratch.md" }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("does not treat a directory name that merely shares a prefix as inside the worktree", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: `${WORKTREE_ROOT}-other/CLAUDE.md` }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "deny");
	});

	it("allows when file_path is missing (nothing to check)", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: undefined }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a relative file_path, since it resolves against cwd and cannot escape", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: "scripts/lib/foo.mjs" }),
			{
				worktreeRoot: WORKTREE_ROOT,
				mainRoot: MAIN_ROOT,
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("detects a worktree living outside .claude/worktrees/ — git, not a naming convention, is the authority", () => {
		// e.g. `git worktree add ../scratch` puts a worktree entirely outside .claude/worktrees/.
		const oddMainRoot = "/Users/m5/repos/pfdsl";
		const oddWorktreeRoot = "/Users/m5/scratch/pfdsl-experiment";
		const result = evaluateWorktreeWriteGuard(
			payload({ filePath: `${oddMainRoot}/CLAUDE.md` }),
			{
				worktreeRoot: oddWorktreeRoot,
				mainRoot: oddMainRoot,
			},
		);
		assert.equal(result.decision, "deny");
	});
});
