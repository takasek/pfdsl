import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	genPluginIdentityStep,
	outputArtifactStatusStep,
	wipTransitionStep,
} from "./gate-check-steps.mjs";

/**
 * A stand-in for the real subprocess runner. `responses` maps a command line
 * ("git diff --quiet") to what it returns; anything unlisted succeeds with no
 * output, and every call is recorded so a test can assert what ran.
 * @param {Record<string, {ok?: boolean, out?: string}>} responses
 */
function fakeExec(responses = {}) {
	/** @type {string[]} */
	const calls = [];
	const exec = (file, args = []) => {
		const line = [file, ...args].join(" ");
		calls.push(line);
		const hit = Object.entries(responses).find(([prefix]) =>
			line.startsWith(prefix),
		);
		return { ok: hit?.[1].ok ?? true, out: hit?.[1].out ?? "" };
	};
	return { exec, calls };
}

const ROADMAP = ".pfdsl/roadmap.pfdsl";

describe("genPluginIdentityStep", () => {
	it("skips when no skill, plugin or install-source path changed", () => {
		const { exec, calls } = fakeExec();
		const result = genPluginIdentityStep({
			exec,
			node: exec,
			changedFiles: ["packages/core/src/graph.ts"],
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /no skill\/plugin\/install-source changes/);
		assert.deepEqual(calls, [], "nothing should run when the step is skipped");
	});

	it("passes when regeneration leaves both output trees unchanged", () => {
		const { exec, calls } = fakeExec();
		const result = genPluginIdentityStep({
			exec,
			node: exec,
			changedFiles: [".claude/skills/pfd-ops/SKILL.md"],
		});
		assert.equal(result.status, "PASS");
		assert.ok(calls.some((c) => c.includes("gen-plugin.mjs")));
		assert.ok(calls.some((c) => c.startsWith("git diff --exit-code")));
	});

	it("fails when regeneration produces a diff in the generated trees", () => {
		const { exec } = fakeExec({ "git diff --exit-code": { ok: false } });
		const result = genPluginIdentityStep({
			exec,
			node: exec,
			changedFiles: [".claude/skills/pfd-ops/SKILL.md"],
		});
		assert.equal(result.status, "FAIL");
	});

	it("fails when the generator itself fails, without asking git about the diff", () => {
		const { exec, calls } = fakeExec();
		const node = () => ({ ok: false, out: "boom" });
		const result = genPluginIdentityStep({
			exec,
			node,
			changedFiles: [".claude/skills/pfd-ops/SKILL.md"],
		});
		assert.equal(result.status, "FAIL");
		assert.deepEqual(
			calls.filter((c) => c.startsWith("git diff")),
			[],
		);
	});

	it("runs for an install-source change, which the plugin trigger alone does not match", () => {
		const { exec, calls } = fakeExec();
		genPluginIdentityStep({
			exec,
			node: exec,
			changedFiles: ["scripts/pfdsl/lib/gh-exec.mjs"],
		});
		assert.ok(calls.some((c) => c.includes("gen-plugin.mjs")));
	});
});

describe("outputArtifactStatusStep", () => {
	const wipThenDone = (key) => ({
		before: `artifact:\n  ${key}:\n    status: wip\n`,
		after: `artifact:\n  ${key}:\n    status: done\n`,
	});

	it("skips on an explicit --no-artifact declaration", () => {
		const { exec, calls } = fakeExec();
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			noArtifact: true,
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "SKIP");
		assert.deepEqual(calls, []);
	});

	it("skips when neither an artifact key nor a roadmap change is present", () => {
		const { exec } = fakeExec();
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			changedFiles: ["packages/core/src/graph.ts"],
		});
		assert.equal(result.status, "SKIP");
	});

	it("passes when the named artifact's status changed between base and HEAD", () => {
		const { before, after } = wipThenDone("spec_v1");
		const { exec } = fakeExec({
			"git show origin/main:": { out: before },
			"git show HEAD:": { out: after },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
	});

	it("fails when a different artifact moved but the named one did not", () => {
		const { exec } = fakeExec({
			"git show origin/main:": { out: "artifact:\n  other:\n    status: wip\n" },
			"git show HEAD:": { out: "artifact:\n  other:\n    status: done\n" },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /spec_v1/);
	});

	it("fails clearly when the roadmap cannot be read at either end", () => {
		const { exec } = fakeExec({ "git show origin/main:": { ok: false } });
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /could not read/);
	});

	it("falls back to a whole-file status diff when no artifact key was given", () => {
		const { exec, calls } = fakeExec({
			"git diff origin/main...HEAD": { out: "-    status: todo\n+    status: wip\n" },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
		assert.ok(calls.some((c) => c.startsWith("git diff origin/main...HEAD")));
	});

	it("fails the fallback when the roadmap changed for some other reason", () => {
		const { exec } = fakeExec({
			"git diff origin/main...HEAD": { out: "-  label: old\n+  label: new\n" },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
	});

	it("fails when git cannot produce the fallback diff", () => {
		const { exec } = fakeExec({
			"git diff origin/main...HEAD": { ok: false, out: "fatal: bad revision" },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /bad revision/);
	});
});

describe("wipTransitionStep", () => {
	it("skips on an explicit --no-artifact declaration", () => {
		const { exec, calls } = fakeExec();
		const result = wipTransitionStep({
			exec,
			base: "main",
			noArtifact: true,
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "SKIP");
		assert.deepEqual(calls, []);
	});

	it("skips when the roadmap is untouched", () => {
		const { exec } = fakeExec();
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: ["README.md"],
		});
		assert.equal(result.status, "SKIP");
	});

	it("passes when some commit's snapshot shows the artifact at wip", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { out: "sha1\nsha2\n" },
			"git show sha1:": { out: "artifact:\n  spec_v1:\n    status: wip\n" },
			"git show sha2:": { out: "artifact:\n  spec_v1:\n    status: done\n" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /spec_v1/);
	});

	it("fails when the artifact went straight to done in every snapshot", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { out: "sha1\n" },
			"git show sha1:": { out: "artifact:\n  spec_v1:\n    status: done\n" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /spec_v1/);
	});

	it("says the check is presence-only when no artifact key narrows it", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { out: "sha1\n" },
			"git show sha1:": { out: "artifact:\n  anything:\n    status: wip\n" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /presence-only/);
	});

	it("ignores a commit whose snapshot cannot be read rather than failing on it", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { out: "gone\nsha2\n" },
			"git show gone:": { ok: false, out: "fatal: bad object" },
			"git show sha2:": { out: "artifact:\n  spec_v1:\n    status: wip\n" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
	});

	it("fails when the commit list itself cannot be produced", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { ok: false, out: "fatal: bad revision" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /bad revision/);
	});
});
