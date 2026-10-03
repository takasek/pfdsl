import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GENERATED_DISTRIBUTION_SOURCES } from "./distribution-sources.mjs";
import {
	evaluateGeneratedRootInstructionsGuard,
	GENERATED_ROOT_INSTRUCTION_FILES,
	mayTargetGeneratedRootInstructions,
} from "./generated-root-instructions-guard.mjs";

const payload = { tool_name: "Write" };
const roots = (worktreeRoot, commonDir = "/repo/.git") => ({
	worktreeRoot,
	commonDir,
});
const context = (path, targetRoots = roots("/worktrees/b")) => ({
	sessionRoots: roots("/repo"),
	targets: [{ path, roots: targetRoots }],
});

describe("evaluateGeneratedRootInstructionsGuard", () => {
	it("ignores non-file tools, including generator commands", () => {
		for (const tool_name of ["Read", "Bash"]) {
			assert.equal(
				evaluateGeneratedRootInstructionsGuard({ tool_name }).decision,
				"allow",
			);
		}
	});

	it("denies every generated root file in the target feature checkout", () => {
		for (const name of Object.keys(GENERATED_ROOT_INSTRUCTION_FILES)) {
			const result = evaluateGeneratedRootInstructionsGuard(
				payload,
				context(`/worktrees/b/${name}`),
			);
			assert.equal(result.decision, "deny");
			assert.match(
				result.reason,
				/\/worktrees\/b\/scripts\/root-instructions-template\/INSTRUCTIONS\.md/,
			);
			assert.match(result.reason, /make gen-plugin/);
		}
	});

	it("allows the template, nested hand-authored instructions, and prefix matches", () => {
		for (const path of [
			"scripts/root-instructions-template/INSTRUCTIONS.md",
			"nested/AGENTS.md",
			"CLAUDE.md.bak",
		]) {
			assert.equal(
				evaluateGeneratedRootInstructionsGuard(
					payload,
					context(`/worktrees/b/${path}`),
				).decision,
				"allow",
			);
		}
	});

	it("allows generated-looking names in foreign and scratch directories", () => {
		assert.equal(
			evaluateGeneratedRootInstructionsGuard(
				payload,
				context("/foreign/AGENTS.md", roots("/foreign", "/foreign/.git")),
			).decision,
			"allow",
		);
		assert.equal(
			evaluateGeneratedRootInstructionsGuard(payload, {
				targets: [{ path: "/tmp/AGENTS.md", outsideRepository: true }],
			}).decision,
			"allow",
		);
	});

	it("does not treat unresolved roots as proof that generated instructions are foreign", () => {
		for (const unresolved of [
			context("/worktrees/b/AGENTS.md", null),
			{ ...context("/worktrees/b/AGENTS.md"), sessionRoots: null },
		]) {
			assert.equal(
				evaluateGeneratedRootInstructionsGuard(payload, unresolved).decision,
				"deny",
			);
		}
	});

	it("checks generated targets after preceding unguarded patch targets", () => {
		const multiple = context("/worktrees/b/source.mjs");
		multiple.targets.push({
			path: "/worktrees/b/AGENTS.md",
			roots: roots("/worktrees/b"),
		});
		assert.equal(
			evaluateGeneratedRootInstructionsGuard(
				{ tool_name: "apply_patch" },
				multiple,
			).decision,
			"deny",
		);
	});

	it("denies unresolved patch targets", () => {
		assert.deepEqual(
			evaluateGeneratedRootInstructionsGuard(payload, {
				error: "Unresolved patch.",
			}),
			{ decision: "deny", reason: "Unresolved patch." },
		);
	});
});

describe("GENERATED_ROOT_INSTRUCTION_FILES", () => {
	it("is every repository-root entry and source in the distribution mapping", () => {
		assert.deepEqual(
			GENERATED_ROOT_INSTRUCTION_FILES,
			Object.fromEntries(
				Object.entries(GENERATED_DISTRIBUTION_SOURCES).filter(
					([name]) => !name.includes("/"),
				),
			),
		);
	});
});

describe("mayTargetGeneratedRootInstructions", () => {
	it("matches generated names only after filesystem path resolution", () => {
		assert.equal(mayTargetGeneratedRootInstructions("/repo/AGENTS.md"), true);
		assert.equal(
			mayTargetGeneratedRootInstructions("/repo/nested/CLAUDE.md"),
			true,
		);
		assert.equal(mayTargetGeneratedRootInstructions("/repo/source.mjs"), false);
		assert.equal(mayTargetGeneratedRootInstructions(undefined), false);
	});
});
