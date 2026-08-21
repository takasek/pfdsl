import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECORD_SEP } from "./commit-trailers.mjs";
import {
	analyzeAdoptedPfdsl,
	checkDocsStep,
	collectCycleWindow,
	collectSizeDeltas,
	commitMessagesSince,
	commitSubjectStep,
	deletedFilesSince,
	designRecordStep,
	fetchDesignRecordEditInfo,
	firstCommitAuthorDate,
	genPluginIdentityStep,
	outputArtifactStatusStep,
	perIssueSteps,
	reviewRecordStep,
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

describe("fetchDesignRecordEditInfo", () => {
	const graphqlResponse = (overrides = {}) =>
		JSON.stringify({
			data: {
				repository: {
					issue: {
						lastEditedAt: null,
						comments: {
							totalCount: 1,
							nodes: [{ id: "c1", lastEditedAt: null }],
							...overrides.comments,
						},
						...overrides.issue,
					},
				},
			},
		});

	it("resolves owner/repo from the git remote and queries via execGh", async () => {
		const { exec } = fakeExec({
			"git remote get-url origin": {
				out: "https://github.com/takasek/pfdsl.git\n",
			},
		});
		/** @type {unknown[]} */
		const calls = [];
		const execGh = async (args, opts) => {
			calls.push({ args, opts });
			return graphqlResponse();
		};
		const result = await fetchDesignRecordEditInfo({
			exec,
			execGh,
			cwd: "/repo",
			number: 737,
		});
		assert.deepEqual(result, {
			issueLastEditedAt: null,
			comments: { totalCount: 1, nodes: [{ id: "c1", lastEditedAt: null }] },
		});
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].opts, { cwd: "/repo" });
		assert.ok(calls[0].args.includes("owner=takasek"));
		assert.ok(calls[0].args.includes("repo=pfdsl"));
		assert.ok(calls[0].args.includes("number=737"));
	});

	it("throws when the git remote cannot be read", async () => {
		const { exec } = fakeExec({
			"git remote get-url origin": { ok: false, out: "fatal: no remote" },
		});
		await assert.rejects(
			fetchDesignRecordEditInfo({
				exec,
				execGh: async () => graphqlResponse(),
				cwd: "/repo",
				number: 737,
			}),
		);
	});

	it("throws when the remote URL carries no owner/repo", async () => {
		const { exec } = fakeExec({
			"git remote get-url origin": { out: "not-a-url\n" },
		});
		await assert.rejects(
			fetchDesignRecordEditInfo({
				exec,
				execGh: async () => graphqlResponse(),
				cwd: "/repo",
				number: 737,
			}),
		);
	});

	it("propagates a rejection from execGh (gh unavailable, GraphQL error, ...)", async () => {
		const { exec } = fakeExec({
			"git remote get-url origin": {
				out: "https://github.com/takasek/pfdsl.git\n",
			},
		});
		await assert.rejects(
			fetchDesignRecordEditInfo({
				exec,
				execGh: async () => {
					throw new Error("boom");
				},
				cwd: "/repo",
				number: 737,
			}),
			/boom/,
		);
	});
});

describe("designRecordStep", () => {
	const issue = ({
		body,
		comments = [],
		createdAt = "2026-06-01T00:00:00Z",
	}) => ({
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

	// #927: a decision written into the issue body is not the record. The body
	// is authored at issue creation, so accepting it made the timing check pass
	// by construction — the issue always predates the branch that closes it.
	it("does not accept a decision written into the issue body", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({ body: validRecordBody }),
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no design-selection record found/);
	});

	it("FAILs when the issue body carries no required line head", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				body: "特に決めていない、ただの説明文です。",
			}),
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
				body: "## 対応案\n1. 案A\n2. 案B\n",
				comments: [
					{
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

	// #737 案1: content deficiency no longer decides the row — only timing
	// does. A content-deficient record still PASSes when its timing is clean,
	// with the deficiency printed as a WARN so it stays legible, distinct from
	// a timing FAIL sharing the same detail string.
	it("PASSes a content-deficient record whose timing is clean, with the deficiency reported as WARN", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
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
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /WARN:.*missing required line/);
	});

	it("identifies the record by its required line heads, with no 決定 line present", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
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

	// Review A-4: `timing.status === "SKIP" ? undefined : editNote` had no test
	// asserting on `detail` for a SKIP row, so it could regress to always
	// including or always dropping editNote without a test noticing. Uses the
	// id-mismatch note (A-3) rather than a coincidentally-empty one, so a
	// broken suppression would make this test fail on content, not on absence.
	it("suppresses the edit note on a SKIP row, even when edit detection has its own note to report", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "" } });
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				body: "普通の説明文。",
				comments: [
					{
						id: "c1",
						author: { login: "owner" },
						body: validRecordBody,
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
			}),
			editInfo: {
				issueLastEditedAt: null,
				comments: {
					totalCount: 1,
					nodes: [{ id: "different-id", lastEditedAt: null }],
				},
			},
		});
		assert.equal(result.status, "SKIP");
		assert.doesNotMatch(result.detail ?? "", /id not found/);
	});

	// #768: the #757 shape — the decision led to not implementing, and a
	// later, unrelated PR happens to be what closes this issue's range. The
	// range is not empty, so the no-commit SKIP above never fires; the record
	// itself has to carry the signal instead.
	it("SKIPs a commit-bearing range when the record's own line head declares no implementation", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				body: "普通の説明文。",
				comments: [
					{
						author: { login: "owner" },
						body: "前提: x\n否定案: y\n却下理由: z\n実装しない: 外部制約に帰着",
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
			}),
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /no implementation commits/);
	});

	// #768 実害の再現: 実際に踏んだ形。前提の一文がこの語を主題として言及しているだけで、
	// どの行の行頭にも `実装しない:` を書いていない。旧実装（部分一致）はこれを誤って
	// SKIP した — 実装コミットが現に存在する回で timing 検査が無効化される偽陰性だった。
	it("does NOT SKIP when the record only mentions the token in prose, not as a line-head declaration", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
				body: "普通の説明文。",
				comments: [
					{
						author: { login: "owner" },
						body: "前提: 本案は〈「実装しない」と決めたサイクルが、その判断を選択記録の `案の処分:` に明記する運用が守られること〉を前提にする\n否定案: y\n却下理由: z",
						createdAt: "2026-07-01T00:00:00Z",
					},
				],
			}),
		});
		assert.equal(result.status, "PASS");
	});

	it("PASSes when the record predates the first commit and covers every enumerated option", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		});
		const result = designRecordStep({
			exec,
			base: "main",
			issue: issue({
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

	// #737 案2: edit detection, wired through the fetched editInfo.
	describe("edit detection", () => {
		const recordComment = (overrides = {}) => ({
			id: "c1",
			author: { login: "owner" },
			body: validRecordBody,
			createdAt: "2026-07-01T00:00:00Z",
			...overrides,
		});
		const firstCommit = {
			"git log --format=%aI": { out: "2026-07-02T00:00:00Z\n" },
		};

		it("PASSes an unedited record (lastEditedAt: null)", () => {
			const { exec } = fakeExec(firstCommit);
			const result = designRecordStep({
				exec,
				base: "main",
				issue: issue({ body: "普通の説明文。", comments: [recordComment()] }),
				editInfo: {
					issueLastEditedAt: null,
					comments: {
						totalCount: 1,
						nodes: [{ id: "c1", lastEditedAt: null }],
					},
				},
			});
			assert.equal(result.status, "PASS");
		});

		it("FAILs when the record was edited after the first commit", () => {
			const { exec } = fakeExec(firstCommit);
			const result = designRecordStep({
				exec,
				base: "main",
				issue: issue({ body: "普通の説明文。", comments: [recordComment()] }),
				editInfo: {
					issueLastEditedAt: null,
					comments: {
						totalCount: 1,
						nodes: [{ id: "c1", lastEditedAt: "2026-07-03T00:00:00Z" }],
					},
				},
			});
			assert.equal(result.status, "FAIL");
			assert.match(result.detail, /edited at/);
		});

		it("PASSes when the record was edited before the first commit", () => {
			const { exec } = fakeExec(firstCommit);
			const result = designRecordStep({
				exec,
				base: "main",
				issue: issue({ body: "普通の説明文。", comments: [recordComment()] }),
				editInfo: {
					issueLastEditedAt: null,
					comments: {
						totalCount: 1,
						nodes: [{ id: "c1", lastEditedAt: "2026-07-01T12:00:00Z" }],
					},
				},
			});
			assert.equal(result.status, "PASS");
		});

		it("judges on timing alone and notes the gap when GraphQL is unavailable", () => {
			const { exec } = fakeExec(firstCommit);
			const result = designRecordStep({
				exec,
				base: "main",
				issue: issue({ body: "普通の説明文。", comments: [recordComment()] }),
				editInfo: null,
			});
			assert.equal(result.status, "PASS");
			assert.match(result.detail, /unavailable/);
		});

		it("skips edit detection and notes it when totalCount exceeds the fetched comments", () => {
			const { exec } = fakeExec(firstCommit);
			const result = designRecordStep({
				exec,
				base: "main",
				issue: issue({ body: "普通の説明文。", comments: [recordComment()] }),
				editInfo: {
					issueLastEditedAt: null,
					comments: {
						totalCount: 101,
						nodes: [{ id: "c1", lastEditedAt: null }],
					},
				},
			});
			assert.equal(result.status, "PASS");
			assert.match(result.detail, /detection/);
		});

		// #927 removed the body from the candidate list, so there is no longer a
		// selected record whose edit history is the issue's own. An issue whose
		// only record-shaped text is in the body has no record at all, and the
		// edit lookup never runs.
		it("never reaches edit detection for an issue whose only record-shaped text is the body", () => {
			const { exec } = fakeExec(firstCommit);
			const result = designRecordStep({
				exec,
				base: "main",
				issue: issue({
					body: validRecordBody,
					createdAt: "2026-07-01T00:00:00Z",
				}),
				editInfo: {
					issueLastEditedAt: "2026-07-03T00:00:00Z",
					comments: { totalCount: 0, nodes: [] },
				},
			});
			assert.equal(result.status, "FAIL");
			assert.match(result.detail, /no design-selection record found/);
		});
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

	it("FAILs on growth when no commit declared an override", () => {
		const result = sizeDirectionStep({
			issue: { body: declared },
			deltas: grown,
			overrideDeclared: false,
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /x\.pfdsl/);
	});

	it("PASSes growth a commit trailer declared", () => {
		const result = sizeDirectionStep({
			issue: { body: declared },
			deltas: grown,
			overrideDeclared: true,
		});
		assert.equal(result.status, "PASS");
	});
});

describe("commitMessagesSince", () => {
	it("reads the branch's messages with the separator both readers expect", () => {
		const { exec, calls } = fakeExec({
			"git log": { out: `feat: a${RECORD_SEP}` },
		});
		const result = commitMessagesSince({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.equal(result.text, `feat: a${RECORD_SEP}`);
		assert.deepEqual(calls, [
			`git log --no-merges origin/main..HEAD --format=%B${RECORD_SEP}`,
		]);
	});

	it("reports the failure rather than an empty range", () => {
		const { exec } = fakeExec({
			"git log": { ok: false, out: "fatal: bad revision\n" },
		});
		const result = commitMessagesSince({ exec, base: "main" });
		assert.equal(result.ok, false);
		assert.equal(result.error, "fatal: bad revision");
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

	// #737 案2: each issue's own edit-info must reach its own row, not the
	// shared args (which have no per-issue value to give).
	it("forwards each issue's own editInfo, not a shared one", () => {
		/** @type {unknown[]} */
		const seen = [];
		const spy = (args) => {
			seen.push(args.editInfo);
			return { name: "s", status: "PASS" };
		};
		perIssueSteps(spy, [
			{ number: 1, issue: { body: "b" }, editInfo: { issueLastEditedAt: "a" } },
			{ number: 2, issue: { body: "c" }, editInfo: null },
		]);
		assert.deepEqual(seen, [{ issueLastEditedAt: "a" }, null]);
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

describe("reviewRecordStep", () => {
	const trailer = "Review: tool=simplify";
	const messages = (text) => ({ ok: true, text });

	it("PASSes when a code-touching branch carries both a gate record and a correctness record", () => {
		const result = reviewRecordStep({
			commitMessages: messages(
				`subject\n\n${trailer}\nReview: tool=correctness\n`,
			),
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "PASS");
	});

	it("PASSes on a single design record, which subsumes both requirements", () => {
		const result = reviewRecordStep({
			commitMessages: messages("subject\n\nReview: tool=design\n"),
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "PASS");
	});

	it("FAILs when a code-touching branch carries no record at all", () => {
		const result = reviewRecordStep({
			commitMessages: messages("subject\n\nbody without a trailer\n"),
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no review record/);
	});

	it("FAILs when a code-touching branch carries only the quality (simplify) record", () => {
		const result = reviewRecordStep({
			commitMessages: messages(`subject\n\n${trailer}\n`),
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no correctness review record/);
	});

	it("FAILs when the record names a tool outside the allowed set", () => {
		const result = reviewRecordStep({
			commitMessages: messages("subject\n\nReview: tool=eyeballs\n"),
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /malformed record/);
	});

	it("PASSes a prose-only branch that carries no record", () => {
		const result = reviewRecordStep({
			commitMessages: messages("docs: x\n\nbody\n"),
			changedFiles: ["docs/adr/0001-x.md"],
		});
		assert.equal(result.status, "PASS");
	});

	it("FAILs when the caller could not read the range", () => {
		const result = reviewRecordStep({
			commitMessages: { ok: false, text: "", error: "fatal: bad revision" },
			changedFiles: ["scripts/lib/x.mjs"],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /bad revision/);
	});
});

// The branch's start, as both the design-record timing check and the cycle
// window measure it. One helper because the two must not drift apart about
// what "when this cycle started" means (#834).
describe("firstCommitAuthorDate", () => {
	it("returns the oldest commit's author date", () => {
		const { exec, calls } = fakeExec({
			"git log --format=%aI --reverse origin/main..HEAD": {
				out: "2026-08-11T00:06:33+09:00\n2026-08-11T00:09:30+09:00\n",
			},
		});
		assert.deepEqual(firstCommitAuthorDate({ exec, base: "main" }), {
			ok: true,
			iso: "2026-08-11T00:06:33+09:00",
		});
		assert.ok(calls.some((c) => c.includes("--reverse")));
	});

	it("reports an empty range as ok with no date, not as a failure", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "" } });
		assert.deepEqual(firstCommitAuthorDate({ exec, base: "main" }), {
			ok: true,
			iso: null,
		});
	});

	it("reports a failed lookup as not ok, which is not the same as no commits", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { ok: false, out: "fatal: bad revision" },
		});
		assert.deepEqual(firstCommitAuthorDate({ exec, base: "main" }), {
			ok: false,
			iso: null,
		});
	});
});

// #834: report material, not a verdict. The window is the union of (1) base
// commits this tree currently lacks and (2) base commits that landed at/after
// the branch's first commit — (2) is what survives a rebase, since after one
// those same commits are ancestors of HEAD while still being reachable from
// origin/<base> with a committer date past the branch's start.
describe("collectCycleWindow", () => {
	it("unions the lagged list with the since-branch-start list", () => {
		const { exec, calls } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				out: "aaa1111\tfix: b\n",
			},
			"git log --format=%aI --reverse origin/main..HEAD": {
				out: "2026-08-01T00:00:00+09:00\n2026-08-02T00:00:00+09:00\n2026-08-03T00:00:00+09:00\n",
			},
			"git log --format=%h%x09%s --since=": { out: "bbb2222\tfeat: c\n" },
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [
			{ sha: "aaa1111", subject: "fix: b" },
			{ sha: "bbb2222", subject: "feat: c" },
		]);
		assert.ok(
			calls.some((c) =>
				c.includes("--since=2026-08-01T00:00:00+09:00 origin/main"),
			),
			"measures from the branch's oldest commit, the last line git log prints",
		);
	});

	// Measured on this branch: `git rebase origin/main` rewrote every commit's
	// committer date to the rebase moment while leaving author dates alone. An
	// anchor read from %cI therefore jumps forward to "now" on the very run this
	// half exists for, and the window collapses to (none) — the reading #834
	// exists to stop, arrived at by a different road.
	it("anchors on the first commit's author date, which a rebase preserves", () => {
		const { exec, calls } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": { out: "" },
			"git log --format=%aI --reverse origin/main..HEAD": {
				out: "2026-08-11T00:06:33+09:00\n2026-08-11T00:09:30+09:00\n",
			},
			"git log --format=%h%x09%s --since=": { out: "bbb2222\tfeat: c\n" },
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [{ sha: "bbb2222", subject: "feat: c" }]);
		assert.ok(
			calls.some((c) =>
				c.includes("--since=2026-08-11T00:06:33+09:00 origin/main"),
			),
			"measures from the oldest commit's author date, not the newest",
		);
		assert.ok(
			!calls.some((c) => c.includes("--format=%cI")),
			"committer dates are rewritten by the rebase this half is measuring across",
		);
	});

	it("skips the since-branch-start half entirely when the branch has no commits yet", () => {
		const { exec, calls } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				out: "aaa1111\tfix: b\n",
			},
			"git log --format=%aI --reverse origin/main..HEAD": { out: "" },
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [{ sha: "aaa1111", subject: "fix: b" }]);
		assert.equal(result.note, undefined);
		assert.ok(!calls.some((c) => c.includes("--since=")));
	});

	it("reports failure of the base-commits-this-tree-lacks query as ok: false", () => {
		const { exec } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				ok: false,
				out: "fatal: bad revision",
			},
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, false);
		assert.equal(result.error, "fatal: bad revision");
	});

	it("keeps part (1) when reading the branch's commit dates fails, noting the gap", () => {
		const { exec } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				out: "aaa1111\tfix: b\n",
			},
			"git log --format=%aI --reverse origin/main..HEAD": {
				ok: false,
				out: "fatal: bad object",
			},
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [{ sha: "aaa1111", subject: "fix: b" }]);
		assert.match(result.note ?? "", /could not/);
	});

	it("keeps part (1) when the since-branch-start query fails, noting the gap", () => {
		const { exec } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				out: "aaa1111\tfix: b\n",
			},
			"git log --format=%aI --reverse origin/main..HEAD": {
				out: "2026-08-01T00:00:00+09:00\n",
			},
			"git log --format=%h%x09%s --since=": {
				ok: false,
				out: "fatal: bad revision",
			},
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [{ sha: "aaa1111", subject: "fix: b" }]);
		assert.match(result.note ?? "", /could not/);
	});
});

describe("analyzeAdoptedPfdsl", () => {
	const deps = (overrides = {}) => ({
		readdirSync: () => ["workflow.pfdsl", "roadmap.pfdsl", "roadmap.md"],
		readFile: (file) => `text of ${file}`,
		analyze: (text) => ({ frontmatter: { title: text } }),
		...overrides,
	});

	it("parses every .pfdsl in the directory, in a stable order, ignoring other files", () => {
		const { analyzed, unreadable } = analyzeAdoptedPfdsl(deps());
		assert.deepEqual(
			analyzed.map((a) => a.file),
			[".pfdsl/roadmap.pfdsl", ".pfdsl/workflow.pfdsl"],
		);
		assert.deepEqual(unreadable, []);
	});

	it("passes the file's text through analyze and keeps the frontmatter", () => {
		const { analyzed } = analyzeAdoptedPfdsl(deps());
		assert.equal(analyzed[0].frontmatter.title, "text of .pfdsl/roadmap.pfdsl");
	});

	// One unparsable file must not cost the report every other file's locations:
	// the block this feeds is material, and a partial reading is worth more than
	// none as long as the gap is named.
	it("isolates a failing file, naming it, and keeps the rest", () => {
		const { analyzed, unreadable } = analyzeAdoptedPfdsl(
			deps({
				analyze: (text) => {
					if (text.includes("workflow")) throw new Error("bad frontmatter");
					return { frontmatter: {} };
				},
			}),
		);
		assert.deepEqual(
			analyzed.map((a) => a.file),
			[".pfdsl/roadmap.pfdsl"],
		);
		assert.deepEqual(unreadable, [".pfdsl/workflow.pfdsl: bad frontmatter"]);
	});
});

describe("deletedFilesSince", () => {
	it("returns the branch's deleted paths, three-dot against the base", () => {
		const { exec, calls } = fakeExec({
			"git diff --diff-filter=D": { out: "docs/samples/gone.svg\n" },
		});
		assert.deepEqual(deletedFilesSince({ exec, base: "main" }), [
			"docs/samples/gone.svg",
		]);
		assert.ok(
			calls.some((c) =>
				c.startsWith("git diff --diff-filter=D --name-only origin/main...HEAD"),
			),
		);
	});

	// The report this feeds is material; a git failure there costs the deleted
	// half of it, not the whole block.
	it("returns nothing rather than throwing when git fails", () => {
		const { exec } = fakeExec({ "git diff --diff-filter=D": { ok: false } });
		assert.deepEqual(deletedFilesSince({ exec, base: "main" }), []);
	});
});
