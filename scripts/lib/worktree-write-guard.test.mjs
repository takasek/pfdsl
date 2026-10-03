import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateWorktreeWriteGuard } from "./worktree-write-guard.mjs";

const payload = { tool_name: "Write", tool_input: { file_path: "/repo/file" } };
const roots = (worktreeRoot, commonDir = "/repo/.git") => ({
	worktreeRoot,
	commonDir,
});
const target = (root, currentBranch, extra = {}) => ({
	path: `${root}/file`,
	roots: roots(root),
	currentBranch,
	mainBranch: "main",
	...extra,
});
const context = (...targets) => ({ sessionRoots: roots("/repo"), targets });

describe("evaluateWorktreeWriteGuard", () => {
	it("ignores tools outside the file editing adapter", () => {
		assert.equal(
			evaluateWorktreeWriteGuard({ tool_name: "Read" }).decision,
			"allow",
		);
	});

	it("allows feature targets in nested, external, and starting checkouts", () => {
		for (const root of ["/repo/.claude/worktrees/b", "/worktrees/b", "/repo"]) {
			assert.equal(
				evaluateWorktreeWriteGuard(payload, context(target(root, "feature")))
					.decision,
				"allow",
			);
		}
	});

	it("denies the resolved default branch regardless of the starting checkout", () => {
		for (const mainBranch of ["main", "master", "trunk"]) {
			const result = evaluateWorktreeWriteGuard(
				payload,
				context(target("/repo", mainBranch, { mainBranch })),
			);
			assert.equal(result.decision, "deny");
			assert.match(result.reason, /branch/);
			assert.match(result.reason, /feature/);
		}
	});

	it("uses the default branch contract rather than reserving names", () => {
		assert.equal(
			evaluateWorktreeWriteGuard(
				payload,
				context(target("/repo", "main", { mainBranch: "trunk" })),
			).decision,
			"allow",
		);
	});

	it("allows a foreign main and a confirmed scratch path", () => {
		assert.equal(
			evaluateWorktreeWriteGuard(
				payload,
				context(
					target("/foreign", "main", {
						roots: roots("/foreign", "/foreign/.git"),
					}),
				),
			).decision,
			"allow",
		);
		assert.equal(
			evaluateWorktreeWriteGuard(
				payload,
				context({ path: "/tmp/file", roots: null, outsideRepository: true }),
			).decision,
			"allow",
		);
	});

	it("does not treat unresolved session, target, or branch identity as foreign", () => {
		for (const unresolved of [
			{ ...context(target("/repo", "feature")), sessionRoots: null },
			context({ path: "/repo/file", roots: null, outsideRepository: false }),
			context(target("/repo", undefined)),
		]) {
			assert.equal(
				evaluateWorktreeWriteGuard(payload, unresolved).decision,
				"deny",
			);
		}
	});

	it("allows a resolved detached checkout", () => {
		assert.equal(
			evaluateWorktreeWriteGuard(payload, context(target("/repo", "")))
				.decision,
			"allow",
		);
	});

	it("denies unresolved file or patch input with the adapter's reason", () => {
		assert.deepEqual(
			evaluateWorktreeWriteGuard(payload, { error: "Use an absolute path." }),
			{ decision: "deny", reason: "Use an absolute path." },
		);
	});

	it("checks every patch target including move destinations", () => {
		const result = evaluateWorktreeWriteGuard(
			{ tool_name: "apply_patch" },
			context(target("/worktrees/b", "feature"), target("/repo", "main")),
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /\/repo\/file/);
	});
});
