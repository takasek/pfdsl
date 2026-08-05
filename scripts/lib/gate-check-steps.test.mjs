import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	checkDocsStep,
	collectSizeDeltas,
	commitSubjectStep,
	designRecordStep,
	genPluginIdentityStep,
	outputArtifactStatusStep,
	perIssueSteps,
	reviewMeasurementStep,
	sizeDirectionStep,
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
			"git show origin/main:": {
				out: "artifact:\n  other:\n    status: wip\n",
			},
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
			"git diff origin/main...HEAD": {
				out: "-    status: todo\n+    status: wip\n",
			},
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
	const issue = ({
		author,
		body,
		comments = [],
		createdAt = "2026-06-01T00:00:00Z",
	}) => ({
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
		const result = designRecordStep({
			exec,
			base: "main",
			issue: null,
			issueFailure: { status: "SKIP", detail: "gh CLI unavailable" },
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	// A lookup that failed for any other reason is not an environment this
	// check tolerates: SKIP here is a row nobody acts on, which is how a check
	// that never ran passed for a whole cycle (#745).
	it("FAILs when the lookup failed for a reason other than a missing gh", () => {
		const { exec } = fakeExec();
		const result = designRecordStep({
			exec,
			base: "main",
			issue: null,
			issueFailure: { status: "FAIL", detail: "issue lookup failed: boom" },
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /boom/);
	});

	it("judges a decision written into the issue body by the same rules as a comment", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({ author: "owner", body: validRecordBody }),
		});
		assert.equal(result.status, "PASS");
	});

	it("FAILs a body carrying only a 決定 line — that line is the filer's settlement, not a selection record", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({ author: "owner", body: "決定: 案A を採用する。" }),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no design-selection record found/);
	});

	it("FAILs when no entry carries any required line head", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "## 対応案\n1. 案A\n2. 案B\n",
				comments: [
					{
						author: { login: "someone-else" },
						body: "決定: 案A",
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
			}),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no design-selection record found/);
	});

	it("FAILs when the owner's record was posted after the first commit", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "## 対応案\n1. 案A\n2. 案B\n",
				comments: [
					{
						author: { login: "owner" },
						body: validRecordBody,
						createdAt: "2026-07-03T00:00:00Z",
					},
				],
			}),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /after the first commit/);
	});

	it("reports a partial record as content-deficient rather than as missing", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "普通の説明文。",
				comments: [
					{
						author: { login: "owner" },
						body: "前提: x",
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
			}),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /missing required line/);
		assert.doesNotMatch(result.detail, /no design-selection record found/);
	});

	it("identifies the record by its required line heads, with no 決定 line present", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "普通の説明文。",
				comments: [
					{
						author: { login: "the-agent" },
						body: "前提: x\n否定案: y\n却下理由: z",
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
			}),
		});
		assert.equal(result.status, "PASS");
	});

	it("picks the entry carrying the most required line heads, not the first one carrying any", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			// The body mentions 前提: in passing — measured to happen in 4 of this
			// repo's issues — and would win a first-match search, leaving the real
			// record in the comment unexamined.
			issue: issue({
				author: "owner",
				body: "## 症状\n前提: この検査は行頭しか見ていない。",
				comments: [
					{
						author: { login: "the-agent" },
						body: "前提: x\n否定案: y\n却下理由: z",
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
			}),
		});
		assert.equal(result.status, "PASS");
	});

	it("SKIPs when a valid record exists but there is no commit in range", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "普通の説明文。",
				comments: [
					{
						author: { login: "owner" },
						body: validRecordBody,
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
			}),
		});
		assert.equal(result.status, "SKIP");
	});

	it("PASSes when the record predates the first commit and covers every enumerated option", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				author: "owner",
				body: "普通の説明文。",
				comments: [
					{
						author: { login: "owner" },
						body: validRecordBody,
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
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
		const result = sizeDirectionStep({
			exec,
			issue: null,
			issueFailure: { status: "SKIP", detail: "gh CLI unavailable" },
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	it("FAILs when the lookup failed for a reason other than a missing gh", () => {
		const { exec } = fakeExec();
		const result = sizeDirectionStep({
			exec,
			issue: null,
			issueFailure: { status: "FAIL", detail: "issue lookup failed: boom" },
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /boom/);
	});

	const grown = [
		{
			path: ".pfdsl/bindings/x.pfdsl",
			beforeBytes: 3,
			afterBytes: 7,
			beforeLines: 2,
			afterLines: 2,
		},
	];
	const declared = "Size-Intent: shrink\n";

	it("SKIPs when the issue declares no size intent", () => {
		const result = sizeDirectionStep({
			issue: { body: "肥大について書いただけ。" },
			deltas: grown,
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /Size-Intent/);
	});

	it("FAILs on growth when the PR body has no override", () => {
		const result = sizeDirectionStep({
			issue: { body: declared },
			deltas: grown,
			prBody: "",
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /x\.pfdsl/);
	});

	it("PASSes growth when the PR body carries a Size-Override token", () => {
		const result = sizeDirectionStep({
			issue: { body: declared },
			deltas: grown,
			prBody: "Size-Override: intentional",
		});
		assert.equal(result.status, "PASS");
	});

	it("carries the caller's verdict on an unfetchable PR body (#749)", () => {
		const result = sizeDirectionStep({
			issue: { body: declared },
			deltas: grown,
			prBodyFailure: { status: "SKIP", detail: "gh CLI unavailable" },
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
		assert.match(result.detail, /x\.pfdsl/);
	});
});

describe("perIssueSteps", () => {
	const step = ({ issue, issueFailure }) => ({
		name: "a step",
		status: issue ? "PASS" : (issueFailure?.status ?? "SKIP"),
		detail: issueFailure?.detail ?? issue?.body,
	});

	it("runs the step once per issue and names each row after its issue", () => {
		const rows = perIssueSteps(step, [
			{ number: 667, issue: { body: "one" } },
			{ number: 668, issue: { body: "two" } },
		]);
		assert.deepEqual(rows, [
			{ name: "a step (#667)", status: "PASS", detail: "one" },
			{ name: "a step (#668)", status: "PASS", detail: "two" },
		]);
	});

	it("keeps a per-issue verdict rather than collapsing to the first one", () => {
		const rows = perIssueSteps(step, [
			{ number: 667, issue: { body: "one" } },
			{
				number: 668,
				issue: null,
				issueFailure: { status: "SKIP", detail: "gh CLI unavailable" },
			},
		]);
		assert.deepEqual(
			rows.map((r) => r.status),
			["PASS", "SKIP"],
		);
	});

	it("carries a FAILing lookup through as that issue's own verdict", () => {
		const rows = perIssueSteps(step, [
			{ number: 667, issue: { body: "one" } },
			{
				number: 668,
				issue: null,
				issueFailure: { status: "FAIL", detail: "issue lookup failed: boom" },
			},
		]);
		assert.deepEqual(
			rows.map((r) => r.status),
			["PASS", "FAIL"],
		);
	});

	it("falls back to the unlabelled single SKIP row when the cycle names no issue", () => {
		const rows = perIssueSteps(step, []);
		assert.deepEqual(rows, [
			{ name: "a step", status: "SKIP", detail: undefined },
		]);
	});

	it("passes the shared arguments through to every call", () => {
		/** @type {unknown[]} */
		const seen = [];
		const spy = (args) => {
			seen.push(args);
			return { name: "s", status: "PASS" };
		};
		perIssueSteps(spy, [{ number: 1, issue: { body: "b" } }], {
			base: "main",
			deltas: [],
		});
		assert.equal(seen.length, 1);
		assert.equal(seen[0].base, "main");
		assert.deepEqual(seen[0].deltas, []);
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
			{
				path: ".pfdsl/bindings/x.pfdsl",
				beforeBytes: 3,
				afterBytes: 7,
				beforeLines: 2,
				afterLines: 2,
			},
		]);
		assert.ok(!calls.some((c) => c.includes("graph.ts")));
	});

	it("treats a new tracked file (no origin/base copy) as growth from zero", () => {
		const { exec } = fakeExec({
			"git show origin/main:.pfdsl/bindings/new.pfdsl": {
				ok: false,
				out: "fatal: does not exist",
			},
			"git show HEAD:.pfdsl/bindings/new.pfdsl": { out: "hello\n" },
		});
		const deltas = collectSizeDeltas({
			exec,
			base: "main",
			changedFiles: [".pfdsl/bindings/new.pfdsl"],
		});
		assert.equal(deltas[0].beforeBytes, 0);
		assert.equal(deltas[0].afterBytes, 6);
	});
});

describe("commitSubjectStep", () => {
	it("excludes merge commits from the collected range (#690)", () => {
		const { exec, calls } = fakeExec({
			"git log": { out: "feat(cli): add a thing\n" },
		});
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
		const { exec } = fakeExec({
			"git log": { ok: false, out: "fatal: bad revision" },
		});
		const result = commitSubjectStep({ exec, base: "main" });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /bad revision/);
	});

	it("FAILs on a non-Conventional subject and names it", () => {
		const { exec } = fakeExec({
			"git log": { out: "feat(cli): ok\nadd a thing\n" },
		});
		const result = commitSubjectStep({ exec, base: "main" });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /add a thing/);
	});

	it("FAILs on a subject carrying unquoted Japanese (#595)", () => {
		const { exec } = fakeExec({
			"git log": {
				out: "refactor(scripts): move it into a dist非依存 module\n",
			},
		});
		const result = commitSubjectStep({ exec, base: "main" });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /non-English/);
	});
});

describe("checkDocsStep", () => {
	it("runs the whole check-docs target rather than one migrated check", () => {
		const { exec, calls } = fakeExec();
		const result = checkDocsStep({ exec });
		assert.equal(result.status, "PASS");
		assert.ok(calls.some((c) => c === "make check-docs"));
	});

	it("FAILs and reports the tail of the output when a check inside the target fails", () => {
		const { exec } = fakeExec({
			"make check-docs": {
				ok: false,
				out: "check-distributed-prose: content an adopting repo cannot resolve:\n  a.md:8: [issue-ref] bare issue reference #716",
			},
		});
		const result = checkDocsStep({ exec });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /issue-ref/);
	});
});

describe("reviewMeasurementStep", () => {
	const trailer =
		'Review-Measurement: sample=in new=1 adopted=1 tool=simplify angles="reuse"';

	it("PASSes when a code-touching branch carries a matching record", () => {
		const { exec } = fakeExec({
			"git log --no-merges": { out: `subject\n\n${trailer}\n` },
		});
		const result = reviewMeasurementStep({
			exec,
			base: "main",
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "PASS");
	});

	it("FAILs when a code-touching branch carries no record at all", () => {
		const { exec } = fakeExec({
			"git log --no-merges": { out: "subject\n\nbody without a trailer\n" },
		});
		const result = reviewMeasurementStep({
			exec,
			base: "main",
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no record/);
	});

	it("FAILs when the record says sample=out but the branch changed code", () => {
		const { exec } = fakeExec({
			"git log --no-merges": {
				out: "subject\n\nReview-Measurement: sample=out\n",
			},
		});
		const result = reviewMeasurementStep({
			exec,
			base: "main",
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /sample=out/);
	});

	it("PASSes a prose-only branch that carries no record", () => {
		const { exec } = fakeExec({
			"git log --no-merges": { out: "docs: x\n\nbody\n" },
		});
		const result = reviewMeasurementStep({
			exec,
			base: "main",
			changedFiles: ["docs/adr/0001-x.md"],
		});
		assert.equal(result.status, "PASS");
	});
});
