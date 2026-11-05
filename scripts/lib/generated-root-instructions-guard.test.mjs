import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GENERATED_DISTRIBUTION_SOURCES } from "./distribution-sources.mjs";
import {
	evaluateGeneratedRootInstructionsGuard,
	GENERATED_ROOT_INSTRUCTION_FILES,
	mayTargetGeneratedRootInstructions,
} from "./generated-root-instructions-guard.mjs";

const WORKTREE_ROOT = "/Users/m5/works/pfdsl/.claude/worktrees/some-branch";

function payload({ toolName = "Write", filePath }) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { file_path: filePath },
	};
}

describe("evaluateGeneratedRootInstructionsGuard", () => {
	it("ignores tools other than Edit/Write", () => {
		const result = evaluateGeneratedRootInstructionsGuard(
			payload({ toolName: "Read", filePath: `${WORKTREE_ROOT}/CLAUDE.md` }),
			WORKTREE_ROOT,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows when the worktree root could not be resolved (not a git repo, git failure)", () => {
		const result = evaluateGeneratedRootInstructionsGuard(
			payload({ filePath: `${WORKTREE_ROOT}/CLAUDE.md` }),
			null,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows when file_path is missing (nothing to check)", () => {
		const result = evaluateGeneratedRootInstructionsGuard(
			payload({ filePath: undefined }),
			WORKTREE_ROOT,
		);
		assert.equal(result.decision, "allow");
	});

	it("denies an Edit of the worktree root's generated CLAUDE.md", () => {
		const result = evaluateGeneratedRootInstructionsGuard(
			payload({ toolName: "Edit", filePath: `${WORKTREE_ROOT}/CLAUDE.md` }),
			WORKTREE_ROOT,
		);
		assert.equal(result.decision, "deny");
		assert.match(
			result.reason,
			/scripts\/root-instructions-template\/INSTRUCTIONS\.md/,
		);
		assert.match(result.reason, /make gen-plugin/);
	});

	it("denies a Write of the worktree root's generated AGENTS.md", () => {
		const result = evaluateGeneratedRootInstructionsGuard(
			payload({ toolName: "Write", filePath: `${WORKTREE_ROOT}/AGENTS.md` }),
			WORKTREE_ROOT,
		);
		assert.equal(result.decision, "deny");
		assert.match(
			result.reason,
			/scripts\/root-instructions-template\/INSTRUCTIONS\.md/,
		);
	});

	it("allows an edit of the template itself", () => {
		const result = evaluateGeneratedRootInstructionsGuard(
			payload({
				toolName: "Edit",
				filePath: `${WORKTREE_ROOT}/scripts/root-instructions-template/INSTRUCTIONS.md`,
			}),
			WORKTREE_ROOT,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows an edit of a same-named file that is not at the worktree root (e.g. scripts/skill-template/CLAUDE.md)", () => {
		const result = evaluateGeneratedRootInstructionsGuard(
			payload({
				toolName: "Edit",
				filePath: `${WORKTREE_ROOT}/scripts/skill-template/CLAUDE.md`,
			}),
			WORKTREE_ROOT,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a directory that merely shares the CLAUDE.md/AGENTS.md name as a prefix", () => {
		const result = evaluateGeneratedRootInstructionsGuard(
			payload({ filePath: `${WORKTREE_ROOT}/CLAUDE.md.bak` }),
			WORKTREE_ROOT,
		);
		assert.equal(result.decision, "allow");
	});
});

describe("GENERATED_ROOT_INSTRUCTION_FILES", () => {
	// Derived, not restated: a third template-rendered root file added to
	// GENERATED_DISTRIBUTION_SOURCES must be guarded without editing this guard.
	it("is every repository-root entry of GENERATED_DISTRIBUTION_SOURCES", () => {
		assert.deepEqual(
			Object.keys(GENERATED_ROOT_INSTRUCTION_FILES).sort(),
			Object.keys(GENERATED_DISTRIBUTION_SOURCES)
				.filter((name) => !name.includes("/"))
				.sort(),
		);
	});

	it("names each file's authoritative source from the same mapping", () => {
		for (const [name, source] of Object.entries(
			GENERATED_ROOT_INSTRUCTION_FILES,
		)) {
			assert.equal(source, GENERATED_DISTRIBUTION_SOURCES[name]);
		}
	});
});

describe("mayTargetGeneratedRootInstructions", () => {
	// The hook runs on every Edit/Write, so the expensive worktree-root lookup
	// (two git subprocesses) must not run for paths that cannot match by name.
	it("rejects a path whose basename is not a guarded root file", () => {
		assert.equal(
			mayTargetGeneratedRootInstructions(`${WORKTREE_ROOT}/src/foo.mjs`),
			false,
		);
	});

	it("accepts a path whose basename is a guarded root file, before any root check", () => {
		assert.equal(
			mayTargetGeneratedRootInstructions(
				`${WORKTREE_ROOT}/scripts/skill-template/CLAUDE.md`,
			),
			true,
		);
	});

	it("rejects a non-string path", () => {
		assert.equal(mayTargetGeneratedRootInstructions(undefined), false);
	});
});
