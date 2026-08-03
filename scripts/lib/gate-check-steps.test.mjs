import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	genPluginIdentityStep,
	outputArtifactStatusStep,
	wipTransitionStep,
	designRecordStep,
	sizeDirectionStep,
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

describe("designRecordStep", () => {
	const issueViewOut = ({ author, body, comments = [] }) =>
		JSON.stringify({ author: { login: author }, body, comments });

	const validRecordBody = [
		"前提: x",
		"否定案: y",
		"却下理由: z",
		"決定: 案A を採用する。",
	].join("\n");

	it("SKIPs when no --issue given", () => {
		const { exec, calls } = fakeExec();
		const result = designRecordStep({ exec, base: "main" });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /--issue/);
		assert.deepEqual(calls, []);
	});

	it("SKIPs when gh CLI is unavailable", () => {
		const { exec } = fakeExec({ "gh issue view": { ok: false } });
		const result = designRecordStep({ exec, base: "main", issueNumber: 669 });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	it("PASSes when the decision is already recorded in the issue body, without checking timing", () => {
		const { exec, calls } = fakeExec({
			"gh issue view": { out: issueViewOut({ author: "owner", body: "決定: 案A を採用する。" }) },
		});
		const result = designRecordStep({ exec, base: "main", issueNumber: 669 });
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /issue body/);
		assert.deepEqual(
			calls.filter((c) => c.startsWith("git log")),
			[],
		);
	});

	it("FAILs when no owner-authored decision comment exists", () => {
		const { exec } = fakeExec({
			"gh issue view": {
				out: issueViewOut({
					author: "owner",
					body: "## 対応案\n1. 案A\n2. 案B\n",
					comments: [{ author: { login: "someone-else" }, body: "決定: 案A", createdAt: "2026-07-01T00:00:00Z" }],
				}),
			},
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({ exec, base: "main", issueNumber: 669 });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no design-selection record found/);
	});

	it("FAILs when the owner's record was posted after the first commit", () => {
		const { exec } = fakeExec({
			"gh issue view": {
				out: issueViewOut({
					author: "owner",
					body: "## 対応案\n1. 案A\n2. 案B\n",
					comments: [{ author: { login: "owner" }, body: validRecordBody, createdAt: "2026-07-03T00:00:00Z" }],
				}),
			},
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({ exec, base: "main", issueNumber: 669 });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /after the first commit/);
	});

	it("FAILs when the record content is missing required prefixes, even though timing is fine", () => {
		const { exec } = fakeExec({
			"gh issue view": {
				out: issueViewOut({
					author: "owner",
					body: "普通の説明文。",
					comments: [{ author: { login: "owner" }, body: "決定: 案A", createdAt: "2026-07-01T00:00:00Z" }],
				}),
			},
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({ exec, base: "main", issueNumber: 669 });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /missing required line/);
	});

	it("SKIPs when a valid record exists but there is no commit in range", () => {
		const { exec } = fakeExec({
			"gh issue view": {
				out: issueViewOut({
					author: "owner",
					body: "普通の説明文。",
					comments: [{ author: { login: "owner" }, body: validRecordBody, createdAt: "2026-07-01T00:00:00Z" }],
				}),
			},
			"git log --format=%aI": { out: "" },
		});
		const result = designRecordStep({ exec, base: "main", issueNumber: 669 });
		assert.equal(result.status, "SKIP");
	});

	it("PASSes when the record predates the first commit and covers every enumerated option", () => {
		const { exec } = fakeExec({
			"gh issue view": {
				out: issueViewOut({
					author: "owner",
					body: "普通の説明文。",
					comments: [{ author: { login: "owner" }, body: validRecordBody, createdAt: "2026-07-01T00:00:00Z" }],
				}),
			},
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({ exec, base: "main", issueNumber: 669 });
		assert.equal(result.status, "PASS");
	});
});

describe("sizeDirectionStep", () => {
	it("SKIPs when no --issue given", () => {
		const { exec, calls } = fakeExec();
		const result = sizeDirectionStep({ exec, base: "main", changedFiles: [] });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /--issue/);
		assert.deepEqual(calls, []);
	});

	it("SKIPs when gh CLI is unavailable", () => {
		const { exec } = fakeExec({ "gh issue view": { ok: false } });
		const result = sizeDirectionStep({ exec, base: "main", issueNumber: 669, changedFiles: [] });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	it("SKIPs when the linked issue states no shrink intent", () => {
		const { exec } = fakeExec({
			"gh issue view": { out: JSON.stringify({ body: "普通の説明。" }) },
		});
		const result = sizeDirectionStep({
			exec,
			base: "main",
			issueNumber: 669,
			changedFiles: [".pfdsl/bindings/x.pfdsl"],
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /no shrink intent/);
	});

	it("computes byte/line deltas for tracked paths only, and FAILs on growth without an override", () => {
		const { exec, calls } = fakeExec({
			"gh issue view": { out: JSON.stringify({ body: "肥大への対策。" }) },
			"git show origin/main:.pfdsl/bindings/x.pfdsl": { out: "aa\n" },
			"git show HEAD:.pfdsl/bindings/x.pfdsl": { out: "aaaaaa\n" },
			"gh pr view": { out: "" },
		});
		const result = sizeDirectionStep({
			exec,
			base: "main",
			issueNumber: 669,
			changedFiles: [".pfdsl/bindings/x.pfdsl", "packages/core/src/graph.ts"],
		});
		assert.equal(result.status, "FAIL");
		assert.ok(!calls.some((c) => c.includes("graph.ts")));
	});

	it("PASSes growth when the PR body carries a Size-Override token", () => {
		const { exec } = fakeExec({
			"gh issue view": { out: JSON.stringify({ body: "肥大への対策。" }) },
			"git show origin/main:.pfdsl/bindings/x.pfdsl": { out: "aa\n" },
			"git show HEAD:.pfdsl/bindings/x.pfdsl": { out: "aaaaaa\n" },
			"gh pr view": { out: "Size-Override: intentional" },
		});
		const result = sizeDirectionStep({
			exec,
			base: "main",
			issueNumber: 669,
			changedFiles: [".pfdsl/bindings/x.pfdsl"],
		});
		assert.equal(result.status, "PASS");
	});

	it("treats a new tracked file (no origin/base copy) as growth from zero", () => {
		const { exec } = fakeExec({
			"gh issue view": { out: JSON.stringify({ body: "肥大への対策。" }) },
			"git show origin/main:.pfdsl/bindings/new.pfdsl": { ok: false, out: "fatal: does not exist" },
			"git show HEAD:.pfdsl/bindings/new.pfdsl": { out: "hello\n" },
			"gh pr view": { out: "" },
		});
		const result = sizeDirectionStep({
			exec,
			base: "main",
			issueNumber: 669,
			changedFiles: [".pfdsl/bindings/new.pfdsl"],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /new\.pfdsl/);
	});
});
