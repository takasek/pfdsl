import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	genPluginIdentityStep,
	outputArtifactStatusStep,
	wipTransitionStep,
	designRecordStep,
	sizeDirectionStep,
	collectSizeDeltas,
	commitSubjectStep,
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
	const issue = ({ author, body, comments = [], createdAt = "2026-06-01T00:00:00Z" }) => ({
		author: { login: author },
		body,
		comments,
		createdAt,
	});

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
		const { exec } = fakeExec();
		const result = designRecordStep({ exec, base: "main", issue: null, issueError: "gh CLI unavailable" });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	it("judges a decision written into the issue body by the same rules as a comment", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({ author: "owner", body: validRecordBody }),
		});
		assert.equal(result.status, "PASS");
	});

	it("FAILs a body decision that lacks the required structure — the body is not an exemption", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({ author: "owner", body: "決定: 案A を採用する。" }),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /missing required line/);
	});

	it("FAILs when no owner-authored decision comment exists", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "## 対応案\n1. 案A\n2. 案B\n",
				comments: [{ author: { login: "someone-else" }, body: "決定: 案A", createdAt: "2026-07-01T00:00:00Z" }],
			}),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no design-selection record found/);
	});

	it("FAILs when the owner's record was posted after the first commit", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "## 対応案\n1. 案A\n2. 案B\n",
				comments: [{ author: { login: "owner" }, body: validRecordBody, createdAt: "2026-07-03T00:00:00Z" }],
			}),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /after the first commit/);
	});

	it("FAILs when the record content is missing required prefixes, even though timing is fine", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "普通の説明文。",
				comments: [{ author: { login: "owner" }, body: "決定: 案A", createdAt: "2026-07-01T00:00:00Z" }],
			}),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /missing required line/);
	});

	it("SKIPs when a valid record exists but there is no commit in range", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "普通の説明文。",
				comments: [{ author: { login: "owner" }, body: validRecordBody, createdAt: "2026-07-01T00:00:00Z" }],
			}),
		});
		assert.equal(result.status, "SKIP");
	});

	it("PASSes when the record predates the first commit and covers every enumerated option", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "普通の説明文。",
				comments: [{ author: { login: "owner" }, body: validRecordBody, createdAt: "2026-07-01T00:00:00Z" }],
			}),
		});
		assert.equal(result.status, "PASS");
	});
});

describe("sizeDirectionStep", () => {
	it("SKIPs when no --issue given", () => {
		const { exec, calls } = fakeExec();
		const result = sizeDirectionStep({ exec });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /--issue/);
		assert.deepEqual(calls, []);
	});

	it("SKIPs when gh CLI is unavailable", () => {
		const { exec } = fakeExec();
		const result = sizeDirectionStep({ exec, issue: null, issueError: "gh CLI unavailable" });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	const grown = [
		{ path: ".pfdsl/bindings/x.pfdsl", beforeBytes: 3, afterBytes: 7, beforeLines: 2, afterLines: 2 },
	];
	const declared = "Size-Intent: shrink\n";

	it("SKIPs without spending any subprocess when the issue declares no size intent", () => {
		const { exec, calls } = fakeExec();
		const result = sizeDirectionStep({ exec, issue: { body: "肥大について書いただけ。" }, deltas: grown });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /Size-Intent/);
		assert.deepEqual(calls, []);
	});

	it("FAILs on growth when the PR body has no override", () => {
		const { exec } = fakeExec({ "gh pr view": { out: "" } });
		const result = sizeDirectionStep({ exec, issue: { body: declared }, deltas: grown });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /x\.pfdsl/);
	});

	it("PASSes growth when the PR body carries a Size-Override token", () => {
		const { exec } = fakeExec({ "gh pr view": { out: "Size-Override: intentional" } });
		const result = sizeDirectionStep({ exec, issue: { body: declared }, deltas: grown });
		assert.equal(result.status, "PASS");
	});
});

describe("collectSizeDeltas", () => {
	it("measures tracked paths only", () => {
		const { exec, calls } = fakeExec({
			"git show origin/main:.pfdsl/bindings/x.pfdsl": { out: "aa\n" },
			"git show HEAD:.pfdsl/bindings/x.pfdsl": { out: "aaaaaa\n" },
		});
		const deltas = collectSizeDeltas({
			exec,
			base: "main",
			changedFiles: [".pfdsl/bindings/x.pfdsl", "packages/core/src/graph.ts"],
		});
		assert.deepEqual(deltas, [
			{ path: ".pfdsl/bindings/x.pfdsl", beforeBytes: 3, afterBytes: 7, beforeLines: 2, afterLines: 2 },
		]);
		assert.ok(!calls.some((c) => c.includes("graph.ts")));
	});

	it("treats a new tracked file (no origin/base copy) as growth from zero", () => {
		const { exec } = fakeExec({
			"git show origin/main:.pfdsl/bindings/new.pfdsl": { ok: false, out: "fatal: does not exist" },
			"git show HEAD:.pfdsl/bindings/new.pfdsl": { out: "hello\n" },
		});
		const deltas = collectSizeDeltas({ exec, base: "main", changedFiles: [".pfdsl/bindings/new.pfdsl"] });
		assert.equal(deltas[0].beforeBytes, 0);
		assert.equal(deltas[0].afterBytes, 6);
	});
});

describe("commitSubjectStep", () => {
	it("excludes merge commits from the collected range (#690)", () => {
		const { exec, calls } = fakeExec({ "git log": { out: "feat(cli): add a thing\n" } });
		const result = commitSubjectStep({ exec, base: "main" });
		const logCall = calls.find((c) => c.startsWith("git log"));
		assert.ok(
			logCall?.includes("--no-merges"),
			`expected --no-merges in the log call, got: ${logCall}`,
		);
		assert.equal(result.status, "PASS");
	});

	it("reads the range from origin/<base> to HEAD", () => {
		const { exec, calls } = fakeExec({ "git log": { out: "feat(cli): a\n" } });
		commitSubjectStep({ exec, base: "release" });
		assert.ok(calls.some((c) => c.includes("origin/release..HEAD")));
	});

	it("SKIPs when the range holds no non-merge commits", () => {
		const { exec } = fakeExec({ "git log": { out: "\n" } });
		const result = commitSubjectStep({ exec, base: "main" });
		assert.equal(result.status, "SKIP");
	});

	it("FAILs when git log fails", () => {
		const { exec } = fakeExec({ "git log": { ok: false, out: "fatal: bad revision" } });
		const result = commitSubjectStep({ exec, base: "main" });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /bad revision/);
	});

	it("FAILs on a non-Conventional subject and names it", () => {
		const { exec } = fakeExec({ "git log": { out: "feat(cli): ok\nadd a thing\n" } });
		const result = commitSubjectStep({ exec, base: "main" });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /add a thing/);
	});
});
