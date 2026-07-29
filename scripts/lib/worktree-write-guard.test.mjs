import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateWorktreeWriteGuard } from "./worktree-write-guard.mjs";

const WORKTREE_CWD = "/Users/m5/works/pfdsl/.claude/worktrees/some-branch";
const MAIN_ROOT = "/Users/m5/works/pfdsl";

function payload({ toolName = "Write", cwd, filePath }) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		cwd,
		tool_input: { file_path: filePath },
	};
}

describe("evaluateWorktreeWriteGuard", () => {
	it("ignores tools other than Edit/Write", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ toolName: "Read", cwd: WORKTREE_CWD, filePath: `${MAIN_ROOT}/CLAUDE.md` }),
		);
		assert.equal(result.decision, "allow");
	});

	it("allows when the session is not inside a worktree at all", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ cwd: MAIN_ROOT, filePath: `${MAIN_ROOT}/CLAUDE.md` }),
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a write that stays inside the current worktree", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ cwd: WORKTREE_CWD, filePath: `${WORKTREE_CWD}/scripts/lib/foo.mjs` }),
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a write to the worktree root itself", () => {
		const result = evaluateWorktreeWriteGuard(payload({ cwd: WORKTREE_CWD, filePath: WORKTREE_CWD }));
		assert.equal(result.decision, "allow");
	});

	it("denies a write into the main repo tree while cwd is inside a worktree (#357)", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ cwd: WORKTREE_CWD, filePath: `${MAIN_ROOT}/CLAUDE.md` }),
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /worktree/i);
	});

	it("denies a write into a sibling worktree", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ cwd: WORKTREE_CWD, filePath: `${MAIN_ROOT}/.claude/worktrees/other-branch/CLAUDE.md` }),
		);
		assert.equal(result.decision, "deny");
	});

	it("allows a write entirely outside the repo tree (scratch files)", () => {
		const result = evaluateWorktreeWriteGuard(payload({ cwd: WORKTREE_CWD, filePath: "/tmp/scratch.md" }));
		assert.equal(result.decision, "allow");
	});

	it("does not treat a directory name that merely shares a prefix as inside the worktree", () => {
		const result = evaluateWorktreeWriteGuard(
			payload({ cwd: WORKTREE_CWD, filePath: `${WORKTREE_CWD}-other/CLAUDE.md` }),
		);
		assert.equal(result.decision, "deny");
	});

	it("allows when cwd or file_path is missing (nothing to check)", () => {
		assert.equal(evaluateWorktreeWriteGuard(payload({ cwd: undefined, filePath: `${MAIN_ROOT}/x` })).decision, "allow");
		assert.equal(evaluateWorktreeWriteGuard(payload({ cwd: WORKTREE_CWD, filePath: undefined })).decision, "allow");
	});

	it("allows a relative file_path, since it resolves against cwd and cannot escape", () => {
		const result = evaluateWorktreeWriteGuard(payload({ cwd: WORKTREE_CWD, filePath: "scripts/lib/foo.mjs" }));
		assert.equal(result.decision, "allow");
	});
});
