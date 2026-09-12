import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cycleStatusExitCode, runCycleStatus } from "./cycle-status-steps.mjs";

const ROOT = "/repo";
const CLI_PATH = "/repo/packages/cli/dist/cli.js";
const TARGET_REPOSITORY = {
	host: "github.com",
	owner: "takasek",
	repo: "pfdsl",
};

const readyJsonOk = (best) =>
	JSON.stringify({
		ok: true,
		ready: [{ id: "a" }],
		best: best ? { id: best, outputs: [`${best}_out`] } : undefined,
	});

// The top-level key is the singular `process:`, matching the real
// .pfdsl/roadmap.pfdsl (an earlier version of this task's brief assumed a
// plural `processes:` key and a per-process `outputs:` field; neither exists
// there — outputs are derived from `>> processId -> artifact` flow-arrow
// lines elsewhere in the file, resolved at runtime via the built CLI's
// `graph neighbors` command rather than parsed from this section).
const roadmapWithIssue = (processId, issueNumber) =>
	roadmapWithIssues([[processId, issueNumber]]);

const roadmapWithIssues = (entries) =>
	`process:\n${entries
		.map(
			([processId, issueNumber]) =>
				`  ${processId}:\n    label: x\n    location: https://github.com/takasek/pfdsl/issues/${issueNumber}\n`,
		)
		.join("")}artifact:\n`;

// `graph neighbors --json` tags each neighbor with its edge class since #828.
const neighborsJsonOk = (successors) =>
	JSON.stringify({
		ok: true,
		predecessors: [],
		successors: successors.map((id) => ({ id, kind: "primary" })),
	});

// A stand-in for createGitHubOps in these tests, which predate the named-op
// API and assert against raw `gh` argv shapes (#1044). Adapts each test's
// `execGh`-shaped fake (an (args: string[]) => Promise<string>, matching what
// gh-exec.mjs's execGh used to be called with directly) into the two
// operations runCycleStatus now calls through githubOps, so every existing
// test body — including the ones asserting on the raw argv it recorded —
// keeps working unchanged.
function githubOpsFromExecGh(execGh) {
	return {
		listOpenPrs: async () =>
			JSON.parse(
				await execGh([
					"pr",
					"list",
					"--state",
					"open",
					"--json",
					"number,title",
				]),
			),
		viewIssue: async ({ number, fields }) =>
			JSON.parse(
				await execGh([
					"issue",
					"view",
					String(number),
					"--json",
					fields.join(","),
				]),
			),
		repository: () => TARGET_REPOSITORY,
	};
}

function baseDeps(overrides = {}) {
	const { execGh, githubOps, ...rest } = overrides;
	return {
		sh: () => "",
		shTry: () => ({ ok: true, out: "", status: 0 }),
		githubOps:
			githubOps ??
			githubOpsFromExecGh(execGh ?? (async () => JSON.stringify([]))),
		existsSync: () => true,
		readFileSync: () => "",
		readdirSync: () => [],
		root: ROOT,
		base: "main",
		...rest,
	};
}

describe("runCycleStatus", () => {
	it("runs preflight without reading or selecting historical cases", async () => {
		const reads = [];
		const result = await runCycleStatus(
			baseDeps({
				readdirSync: (path) => {
					reads.push(path);
					throw new Error("historical cases are unavailable");
				},
			}),
		);
		assert.deepEqual(reads, []);
		assert.equal(result.preArtifactPatterns, undefined);
		assert.equal(result.preArtifactSelection, undefined);
		assert.equal(result.preArtifactPatternsError, undefined);
		assert.equal(result.fetched, true);
		assert.equal(cycleStatusExitCode(result), 0);
	});

	it("uses a non-zero exit code for blocking lookup failures only", () => {
		assert.equal(cycleStatusExitCode({ blocking: true }), 1);
		assert.equal(cycleStatusExitCode({ blocking: false }), 0);
		assert.equal(cycleStatusExitCode({}), 0);
	});

	it("reports fetched:false when git fetch throws, without aborting the rest", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("fetch")) throw new Error("no network");
					if (args.includes("log")) return "";
					return readyJsonOk(null);
				},
			}),
		);
		assert.equal(result.fetched, false);
	});

	it("sets behindBaseError and leaves behindBase null when the log command throws", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("log")) throw new Error("fatal: bad revision");
					if (args.includes("--porcelain")) return "";
					return readyJsonOk(null);
				},
			}),
		);
		assert.equal(result.behindBase, null);
		assert.equal(result.behindBaseError, "fatal: bad revision");
	});

	it("counts behindBase from git log output on success", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("log")) return "abc commit one\ndef commit two\n";
					return readyJsonOk(null);
				},
			}),
		);
		assert.equal(result.behindBase, 2);
		assert.equal(result.behindBaseError, undefined);
	});

	it("refuses to produce judgments when the tree is behind base", async () => {
		const calls = [];
		const ghCalls = [];
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					calls.push([file, args]);
					if (args.includes("log")) return "abc commit one\ndef commit two\n";
					return readyJsonOk("proc_a");
				},
				execGh: async (args) => {
					ghCalls.push(args);
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.behindBase, 2);
		assert.equal(result.staleTree.base, "main");
		assert.match(result.staleTree.message, /2 commits behind origin\/main/);
		// Every judgment is withheld, not merely annotated: an old tree's output
		// cannot say whether a check ran and passed or does not exist there (#716).
		assert.equal(result.ready, undefined);
		assert.equal(result.best, undefined);
		assert.equal(result.designUnsettledFor, undefined);
		assert.equal(result.gateCheckCommand, undefined);
		assert.equal(result.preArtifactPatterns, undefined);
		assert.ok(!calls.some(([, args]) => args.includes(CLI_PATH)));
		assert.deepEqual(ghCalls, []);
	});

	// #744: `commitsAheadOfBase` closes the committed path from one cycle into
	// the next, and leaves the working tree's. Switching branches carries
	// uncommitted edits along, so the previous cycle's changes are still there
	// to be swept into this cycle's first commit.
	it("refuses to produce judgments when the tree has uncommitted changes", async () => {
		const calls = [];
		const ghCalls = [];
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					calls.push([file, args]);
					if (args.includes("--porcelain"))
						return " M scripts/gate-check.mjs\n?? notes.txt\n";
					if (args.includes("log")) return "";
					return readyJsonOk("proc_a");
				},
				execGh: async (args) => {
					ghCalls.push(args);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.uncommittedFiles, [
			"scripts/gate-check.mjs",
			"notes.txt",
		]);
		assert.match(result.dirtyTree.message, /uncommitted/i);
		assert.equal(result.ready, undefined);
		assert.equal(result.best, undefined);
		assert.equal(result.designUnsettledFor, undefined);
		assert.equal(result.gateCheckCommand, undefined);
		assert.equal(result.preArtifactPatterns, undefined);
		assert.ok(!calls.some(([, args]) => args.includes(CLI_PATH)));
		assert.deepEqual(ghCalls, []);
	});

	it("says nothing about a dirty tree when the tree is clean", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("--porcelain")) return "";
					if (args.includes("log")) return "";
					return readyJsonOk("proc_a");
				},
			}),
		);
		assert.equal(result.dirtyTree, undefined);
		assert.equal(result.uncommittedFiles, undefined);
		assert.equal(result.best, "proc_a");
	});

	// A tree that is both behind and dirty is reported as behind: that verdict
	// says the script itself is the wrong version, which makes every other
	// judgment — including the dirty one — unreliable (#716).
	it("reports a stale tree ahead of a dirty one", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("--porcelain"))
						return " M scripts/gate-check.mjs\n";
					if (args.includes("log")) return "abc one\n";
					return readyJsonOk("proc_a");
				},
			}),
		);
		assert.ok(result.staleTree);
		assert.equal(result.dirtyTree, undefined);
	});

	it("sets dirtyTreeError and keeps judging when git status itself fails", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("--porcelain"))
						throw new Error("fatal: not a git repo");
					if (args.includes("log")) return "";
					return readyJsonOk("proc_a");
				},
			}),
		);
		assert.equal(result.dirtyTreeError, "fatal: not a git repo");
		assert.equal(result.best, "proc_a");
	});

	it("sets prError and an empty PR list when gh pr list fails", async () => {
		const result = await runCycleStatus(
			baseDeps({
				execGh: async () => {
					throw new Error("gh: not authenticated");
				},
			}),
		);
		assert.deepEqual(result.openPRs, []);
		assert.equal(result.prError, "gh: not authenticated");
	});

	it("lists all open PRs without special handling for old flow-sync branches", async () => {
		const result = await runCycleStatus(
			baseDeps({
				execGh: async (args) => {
					if (args[0] === "pr") {
						return JSON.stringify([
							{ number: 1, title: "sync", headRefName: "flow-sync/x" },
							{ number: 2, title: "feature", headRefName: "feat/x" },
						]);
					}
					return "";
				},
			}),
		);
		assert.deepEqual(result.openPRs, [
			{ number: 1, title: "sync" },
			{ number: 2, title: "feature" },
		]);
		assert.equal(result.prError, undefined);
	});

	it("sets a fixed readyError and skips the CLI call when the built CLI is missing", async () => {
		const calls = [];
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					calls.push([file, args]);
					return "";
				},
				existsSync: () => false,
			}),
		);
		assert.equal(
			result.readyError,
			"packages/cli/dist/cli.js not built; run 'pnpm -r build' first",
		);
		assert.deepEqual(result.ready, []);
		assert.equal(result.best, null);
		assert.ok(!calls.some(([, args]) => args.includes(CLI_PATH)));
	});

	it("sets readyError when the built CLI call throws", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) throw new Error("cli crashed");
					return "";
				},
			}),
		);
		assert.equal(result.readyError, "cli crashed");
		assert.deepEqual(result.ready, []);
		assert.equal(result.best, null);
	});

	it("parses ready/best from a successful CLI call", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
			}),
		);
		assert.deepEqual(result.ready, ["a"]);
		assert.equal(result.best, null);
	});

	const issueJson = ({ body, comments = [], labels = [] }) =>
		JSON.stringify({ body, comments, labels });
	const runForIssueBodies = (issueNumbers, bodies) =>
		runCycleStatus(
			baseDeps({
				issueNumbers,
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: bodies[args[2]] });
					return JSON.stringify([]);
				},
			}),
		);

	it("resolves the target issue from --issue when given, ignoring any best process", async () => {
		const calls = [];
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					calls.push(args);
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.designUnsettledFor, [
			{
				issue: 669,
				source: "flag",
				unsettled: true,
				reason: "no-enumerated-options",
				matchedLines: [],
				optionCount: 0,
				missingPrefixes: [],
				record: null,
				recordRequired: true,
			},
		]);
		assert.equal(result.designUnsettledError, undefined);
		assert.ok(calls.some((c) => c[0] === "issue" && c.includes("669")));
		assert.ok(!calls.some((c) => c[0] === "issue" && c.includes("42")));
	});

	// #927: the classifier says which required line the elected record is
	// missing, and that is the whole reason the threshold sits in the classifier
	// rather than in selectDesignRecord. It has to survive into the output the
	// runner reads, or the reason value arrives with no way to act on it.
	it("carries missingPrefixes through to the reported classification", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJson({
							body: "普通の説明文。",
							comments: [
								{
									body: "前提: x\n否定案: y",
									createdAt: "2026-01-01T00:00:00Z",
								},
							],
						});
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designUnsettledFor[0].reason, "record-incomplete");
		assert.deepEqual(result.designUnsettledFor[0].missingPrefixes, [
			"却下理由:",
		]);
	});

	it("carries incomplete format 3 problems without legacy repair prefixes", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				sh: (_file, args) =>
					args.includes(CLI_PATH) ? readyJsonOk("proc_a") : "",
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) =>
					args[0] === "issue"
						? issueJson({
								body: "普通の説明文。",
								comments: [
									{
										body: "設計記録形式: 3",
										createdAt: "2026-08-31T01:30:24Z",
									},
								],
							})
						: JSON.stringify([]),
			}),
		);
		const payload = result.designUnsettledFor[0];
		assert.equal(payload.reason, "record-incomplete");
		assert.deepEqual(payload.missingPrefixes, []);
		assert.ok(payload.problems.some((problem) => problem.includes("決定:")));
	});

	it("recognizes a decorated format 3 marker before computing repair prefixes", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				sh: (_file, args) =>
					args.includes(CLI_PATH) ? readyJsonOk("proc_a") : "",
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) =>
					args[0] === "issue"
						? issueJson({
								body: "普通の説明文。",
								comments: [
									{
										body: "> 設計記録形式: 3",
										createdAt: "2026-08-31T01:30:24Z",
									},
								],
							})
						: JSON.stringify([]),
			}),
		);
		const payload = result.designUnsettledFor[0];
		assert.equal(payload.reason, "record-incomplete");
		assert.deepEqual(payload.missingPrefixes, []);
		assert.ok(payload.problems.some((problem) => problem.includes("決定:")));
	});

	it("reports reader-first prefixes missing from a post-cutoff legacy record", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJson({
							body: "普通の説明文。",
							comments: [
								{
									body: "前提: x\n否定案: y\n却下理由: z",
									createdAt: "2026-08-30T09:32:50Z",
								},
							],
						});
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designUnsettledFor[0].reason, "record-incomplete");
		assert.deepEqual(result.designUnsettledFor[0].missingPrefixes, [
			"提案:",
			"理由:",
			"前提を外した対案:",
			"対案を採らない理由:",
		]);
	});

	it("keeps reversed reader-first lines unsettled in the reported classification", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJson({
							body: "普通の説明文。",
							comments: [
								{
									body: "対案を採らない理由: w\n前提を外した対案: z\n理由: y\n提案: x",
									createdAt: "2026-08-30T09:32:50Z",
								},
							],
						});
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designUnsettledFor[0].reason, "record-incomplete");
		assert.equal(result.designUnsettledFor[0].recordRequired, true);
	});

	it("keeps a malformed comment timestamp unsettled in the reported classification", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJson({
							body: "普通の説明文。",
							comments: [
								{
									body: "提案: x\n理由: y\n前提を外した対案: z\n対案を採らない理由: w",
									createdAt: "not-an-iso-timestamp",
								},
							],
						});
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designUnsettledFor[0].reason, "record-incomplete");
		assert.equal(result.designUnsettledFor[0].recordRequired, true);
	});

	it("resolves the target issue from the best process when --issue is absent", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJson({
							body: "設計未確定な点がある。",
						});
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designUnsettledFor.length, 1);
		assert.equal(result.designUnsettledFor[0].issue, 42);
		assert.equal(result.designUnsettledFor[0].source, "best-process");
		assert.equal(result.designUnsettledFor[0].unsettled, true);
		assert.equal(result.designUnsettledFor[0].reason, "phrase");
		assert.equal(result.designUnsettledFor[0].recordRequired, true);
	});

	it("judges every issue the cycle closes, not just the first", async () => {
		const bodies = {
			667: "普通の説明文。",
			668: "## 対応案\n1. 案A\n2. 案B\n",
		};
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [667, 668],
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: bodies[args[2]] });
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(
			result.designUnsettledFor.map((d) => [d.issue, d.unsettled]),
			[
				[667, true],
				[668, true],
			],
		);
	});

	it("fetches revised-record edit info by node ID and exposes evidence detail", async () => {
		const editCalls = [];
		const recordBody = [
			"設計記録形式: 3",
			"決定:",
			"- 保存方式（実装）: Aを段階導入する",
			"理由:",
			"- 保存方式: 障害範囲を限定できる",
			"案の処分:",
			"- 採用 — 元候補「A」— 今回採用する",
			"前提検査 P1:",
			"対象: 保存方式 / A",
			"前提: 保存方式と通知方式を同時に変える必要がある",
			"前提を外した案: 保存方式だけを段階導入する",
			"既存候補との差分: 元候補は両方式を一組としていた",
			"検査案の処分 P1: 採用 — 今回の決定に含める",
			"改訂履歴:",
			"- A → B — 変更理由 — 再承認: https://github.com/takasek/pfdsl/issues/1098#issuecomment-20",
		].join("\n");
		const comments = [
			{
				id: "IC_record",
				databaseId: 10,
				body: recordBody,
				createdAt: "2026-09-05T15:00:00Z",
				url: "https://github.com/takasek/pfdsl/issues/1098#issuecomment-10",
			},
			{
				id: "IC_approval",
				databaseId: 20,
				createdAt: "2026-09-05T15:30:00Z",
				url: "https://github.com/takasek/pfdsl/issues/1098#issuecomment-20",
			},
		];
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [1098],
				githubOps: {
					listOpenPrs: async () => [],
					repository: () => TARGET_REPOSITORY,
					viewIssue: async () => ({
						body: "普通の説明文。",
						comments,
						labels: [],
					}),
					designRecordEditInfo: async (params) => {
						editCalls.push(params);
						return {
							status: "edited",
							editedAtIso: "2026-09-05T16:00:00Z",
						};
					},
				},
			}),
		);
		assert.deepEqual(editCalls, [{ nodeId: "IC_record" }]);
		assert.equal(result.designUnsettledFor[0].unsettled, false);
		assert.equal(result.designUnsettledFor[0].reason, "record-posted");
		assert.match(result.designUnsettledFor[0].detail, /server-recorded/);
	});

	it("resolves a selected record's edit time when the issue has more than 100 comments", async () => {
		const editCalls = [];
		const recordBody = [
			"設計記録形式: 3",
			"決定:",
			"- 保存方式（実装）: Aを段階導入する",
			"理由:",
			"- 保存方式: 障害範囲を限定できる",
			"案の処分:",
			"- 採用 — 元候補「A」— 今回採用する",
			"前提検査 P1:",
			"対象: 保存方式 / A",
			"前提: 保存方式と通知方式を同時に変える必要がある",
			"前提を外した案: 保存方式だけを段階導入する",
			"既存候補との差分: 元候補は両方式を一組としていた",
			"検査案の処分 P1: 採用 — 今回の決定に含める",
			"改訂履歴:",
			"- A → B — 変更理由 — 再承認: https://github.com/takasek/pfdsl/issues/1098#issuecomment-20",
		].join("\n");
		const comments = [
			{
				id: "IC_record",
				databaseId: 10,
				body: recordBody,
				createdAt: "2026-09-05T15:00:00Z",
				url: "https://github.com/takasek/pfdsl/issues/1098#issuecomment-10",
			},
			{
				id: "IC_approval",
				databaseId: 20,
				createdAt: "2026-09-05T15:30:00Z",
				url: "https://github.com/takasek/pfdsl/issues/1098#issuecomment-20",
			},
			...Array.from({ length: 99 }, (_, index) => ({
				id: `IC_noise_${index}`,
				body: "通常のコメント。",
				createdAt: "2026-09-05T15:31:00Z",
			})),
		];
		assert.equal(comments.length, 101);
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [1098],
				githubOps: {
					listOpenPrs: async () => [],
					repository: () => TARGET_REPOSITORY,
					viewIssue: async () => ({
						body: "普通の説明文。",
						comments,
						labels: [],
					}),
					designRecordEditInfo: async (params) => {
						editCalls.push(params);
						return {
							status: "edited",
							editedAtIso: "2026-09-05T16:00:00Z",
						};
					},
				},
			}),
		);
		assert.deepEqual(editCalls, [{ nodeId: "IC_record" }]);
		assert.equal(result.designUnsettledFor[0].unsettled, false);
	});

	it("keeps a grandfathered free-form format 3 record settled through the step", async () => {
		const recordBody = [
			"設計記録形式: 3",
			"決定:",
			"- 保存方式（実装）: Aを段階導入する",
			"理由:",
			"- 保存方式: 障害範囲を限定できる",
			"案の処分:",
			"- 採用 — 元候補「A」— 今回採用する",
			"前提検査 P1:",
			"対象: 保存方式 / A",
			"前提: 保存方式と通知方式を同時に変える必要がある",
			"前提を外した案: 保存方式だけを段階導入する",
			"既存候補との差分: 元候補は両方式を一組としていた",
			"検査案の処分 P1: 採用 — 今回の決定に含める",
			"改訂履歴:",
			"- A → B — 変更理由 — 再承認: このコメント直前のユーザー承認",
		].join("\n");
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [1098],
				githubOps: {
					listOpenPrs: async () => [],
					viewIssue: async () => ({
						body: "普通の説明文。",
						comments: [
							{
								id: "IC_record",
								body: recordBody,
								createdAt: "2026-09-05T14:07:15Z",
							},
						],
						labels: [],
					}),
				},
			}),
		);
		assert.equal(result.designUnsettledFor[0].unsettled, false);
		assert.equal(result.designUnsettledFor[0].reason, "record-posted");
	});

	it("keeps the issues it could read when one lookup throws", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [667, 668],
				execGh: async (args) => {
					if (args[0] === "issue") {
						if (args[2] === "668") throw new Error("gh: issue not found");
						return issueJson({ body: "普通の説明文。" });
					}
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(
			result.designUnsettledFor.map((d) => d.issue),
			[667],
		);
		assert.equal(result.designUnsettledError, "gh: issue not found");
	});

	it("builds a gate-check command naming every issue the cycle closes", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [667, 668],
				sh: (_file, args) => {
					if (args.includes("neighbors")) return neighborsJsonOk(["art_a"]);
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () =>
					roadmapWithIssues([
						["proc_a", 667],
						["proc_a", 668],
					]),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.match(result.gateCheckCommand, /--issue 667 --issue 668$/);
	});

	it("reports the current branch and how far HEAD leads the base", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("rev-parse")) return "feat/second-cycle\n";
					if (args.join(" ").includes("origin/main..HEAD"))
						return "abc one\ndef two\n";
					return "";
				},
			}),
		);
		assert.equal(result.currentBranch, "feat/second-cycle");
		assert.equal(result.commitsAheadOfBase, 2);
	});

	it("reports commitsAheadOfBase 0 for a branch cut fresh from the base", async () => {
		const result = await runCycleStatus(baseDeps({ sh: () => "" }));
		assert.equal(result.commitsAheadOfBase, 0);
	});

	it("sets headStateError and leaves both head fields null when git cannot answer", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("rev-parse"))
						throw new Error("fatal: not a git repository");
					return "";
				},
			}),
		);
		assert.equal(result.currentBranch, null);
		assert.equal(result.commitsAheadOfBase, null);
		assert.equal(result.headStateError, "fatal: not a git repository");
	});

	it("keeps the format 3 design-record template independent of enumerated option count", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [721],
				execGh: async (args) => {
					if (args[0] === "issue") {
						return issueJson({
							body: "## 検討したい方向\n1. 案A\n2. 案B\n3. 案C\n",
						});
					}
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designRecordTemplate.lines[0], "設計記録形式: 3");
		assert.deepEqual(
			result.designRecordTemplate.lines.filter((line) =>
				line.startsWith("案の処分 "),
			),
			[],
		);
	});

	it("does not claim design review is required when an issue enumerates ordinary steps", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [1008],
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJson({
							body: "## 実装手順\n1. 準備する\n2. 実行する\n",
						});
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal("reviewRecordTemplate" in result, false);
		assert.equal("designReviewRequirements" in result, false);
	});

	it("keeps later Markdown enumeration advisory instead of turning it into a review gate", async () => {
		const bodies = {
			1009: "## 対応案\n1. 案A\n",
			1010: "普通の説明文。",
			1008: "## 対応案\n1. 案A\n2. 案B\n",
		};
		const result = await runForIssueBodies([1009, 1010, 1008], bodies);
		assert.equal("reviewRecordTemplate" in result, false);
		assert.equal("designReviewRequirements" in result, false);
	});

	it("keeps ordinary fallback for a multi-issue set without multiple options", async () => {
		const bodies = {
			1009: "## 対応案\n1. 案A\n",
			1010: "普通の説明文。",
		};
		const result = await runForIssueBodies([1009, 1010], bodies);
		assert.equal("reviewRecordTemplate" in result, false);
	});

	it("emits the design-record template even when no issue could be resolved", async () => {
		const result = await runCycleStatus(baseDeps({}));
		assert.deepEqual(result.designUnsettledFor, []);
		assert.ok(result.designRecordTemplate.lines.length > 0);
		assert.ok(result.designRecordTemplate.lines.includes("案の処分:"));
	});

	it("does not prescribe a review trailer while retaining the design record template", async () => {
		const result = await runCycleStatus(baseDeps({}));
		assert.equal("reviewRecordTemplate" in result, false);
		assert.ok(result.designRecordTemplate.lines.includes("改訂履歴:"));
	});

	it("returns a null designUnsettledFor with an error when neither --issue nor a best process is available", async () => {
		const calls = [];
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				execGh: async (args) => {
					calls.push(args);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.designUnsettledFor, []);
		assert.equal(
			result.designUnsettledError,
			"no --issue given and no best process to resolve an issue number from",
		);
		assert.ok(!calls.some((c) => c[0] === "issue"));
	});

	it("returns a null designUnsettledFor with the roadmap error when the best process has no issue number", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => "processes:\n  proc_a:\n    label: x\n",
			}),
		);
		assert.deepEqual(result.designUnsettledFor, []);
		assert.equal(
			result.designUnsettledError,
			"no issue number found for process 'proc_a' in .pfdsl/roadmap.pfdsl",
		);
	});

	it("preserves a best-process roadmap read failure as the gate-command error", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => {
					throw new Error("roadmap unreadable");
				},
			}),
		);
		assert.equal(result.gateCheckCommand, null);
		assert.equal(result.gateCheckCommandError, "roadmap unreadable");
	});

	it("returns a null designUnsettledFor with the gh error when the gh issue lookup throws", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				execGh: async (args) => {
					if (args[0] === "issue") throw new Error("gh: issue not found");
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.designUnsettledFor, []);
		assert.equal(result.designUnsettledError, "gh: issue not found");
		assert.equal(result.gateCheckCommand, null);
		assert.equal(
			result.gateCheckCommandError,
			"cannot determine whether issue 669 is flow:exempt because its labels could not be fetched: gh: issue not found",
		);
	});

	// #794: the artifact named in the gate-check command comes from the process
	// the resolved issue maps to in roadmap.pfdsl (via `graph neighbors`), not
	// from bestOutputs — an --issue can name an issue that has nothing to do
	// with the best process.
	it("resolves the gate-check artifact through the process the best-process issue maps to", async () => {
		const calls = [];
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					calls.push(args);
					if (args.includes("neighbors"))
						return neighborsJsonOk(["proc_a_out"]);
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
			}),
		);
		// The resolved issue rides along: the operator copies this line verbatim,
		// so the checks that need --issue would otherwise SKIP every cycle (#669).
		assert.equal(
			result.gateCheckCommand,
			"node scripts/gate-check.mjs --base main --artifact proc_a_out --issue 42",
		);
		assert.ok(
			calls.some(
				(args) => args.includes("neighbors") && args.includes("proc_a"),
			),
		);
	});

	// #828 widened `graph neighbors` to report `>>?` neighbors alongside the
	// producer/consumer ones. The artifact under gate is the process's output, so
	// a feedback neighbor must not be picked up as one.
	it("takes the gate-check artifact from a primary successor, not a feedback one", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (_file, args) => {
					if (args.includes("neighbors"))
						return JSON.stringify({
							ok: true,
							predecessors: [],
							successors: [
								{ id: "loops_back", kind: "feedback" },
								{ id: "proc_a_out", kind: "primary" },
							],
						});
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
			}),
		);
		assert.equal(
			result.gateCheckCommand,
			"node scripts/gate-check.mjs --base main --artifact proc_a_out --issue 42",
		);
	});

	it("resolves the gate-check artifact through the process an explicit --issue maps to", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [669],
				sh: (_file, args) => {
					if (args.includes("neighbors")) return neighborsJsonOk(["art_x"]);
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_x", 669),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(
			result.gateCheckCommand,
			"node scripts/gate-check.mjs --base main --artifact art_x --issue 669",
		);
		assert.equal(
			result.wipUpdateCommand,
			"node packages/cli/dist/cli.js meta set .pfdsl/roadmap.pfdsl art_x status wip",
		);
	});

	// This is the actual shape of #800/#772/#794 themselves: all three are
	// flow:exempt, so none has a roadmap process to resolve an artifact from.
	it("falls back to --no-artifact when the --issue's issue has no roadmap process (exempt issue)", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [800],
				readFileSync: () => roadmapWithIssue("proc_x", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJson({
							body: "普通の説明文。",
							labels: [{ name: "flow:exempt" }],
						});
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(
			result.gateCheckCommand,
			"node scripts/gate-check.mjs --base main --no-artifact --issue 800",
		);
		assert.equal(result.wipUpdateCommand, undefined);
	});

	it("uses the shared process's artifact when every --issue resolves to the same process", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [667, 668],
				sh: (_file, args) => {
					if (args.includes("neighbors"))
						return neighborsJsonOk(["shared_art"]);
					return "";
				},
				readFileSync: () =>
					roadmapWithIssues([
						["proc_shared", 667],
						["proc_shared", 668],
					]),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(
			result.gateCheckCommand,
			"node scripts/gate-check.mjs --base main --artifact shared_art --issue 667 --issue 668",
		);
	});

	it("falls back to --no-artifact when --issue numbers resolve to different processes", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [667, 668],
				sh: (_file, args) => {
					if (args.includes("neighbors"))
						return neighborsJsonOk(["should_not_be_used"]);
					return "";
				},
				readFileSync: () =>
					roadmapWithIssues([
						["proc_a", 667],
						["proc_b", 668],
					]),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(
			result.gateCheckCommand,
			"node scripts/gate-check.mjs --base main --no-artifact --issue 667 --issue 668",
		);
	});

	it("returns a null gate-check command when there is no best process", async () => {
		const result = await runCycleStatus(baseDeps());
		assert.equal(result.gateCheckCommand, null);
		assert.equal(
			result.gateCheckCommandError,
			"no --issue given and no best process to resolve a gate-check command",
		);
	});

	it("reports why a managed process output cannot be resolved", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [969],
				sh: (_file, args) => {
					if (args.includes("neighbors")) throw new Error("broken neighbors");
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_x", 969),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.gateCheckCommand, null);
		assert.equal(
			result.gateCheckCommandError,
			"failed to resolve the output artifact for process 'proc_x': broken neighbors",
		);
	});

	it("reports that the built CLI is required to resolve a managed process output", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [969],
				existsSync: () => false,
				readFileSync: () => roadmapWithIssue("proc_x", 969),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.gateCheckCommand, null);
		assert.equal(
			result.gateCheckCommandError,
			"failed to resolve the output artifact for process 'proc_x': packages/cli/dist/cli.js not built; run 'pnpm -r build' first",
		);
	});

	it("reports when graph neighbors has no primary output artifact", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [969],
				sh: (_file, args) => {
					if (args.includes("neighbors")) return neighborsJsonOk([]);
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_x", 969),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.gateCheckCommand, null);
		assert.equal(
			result.gateCheckCommandError,
			"failed to resolve the output artifact for process 'proc_x': graph neighbors returned no primary successor",
		);
	});
});

describe("runCycleStatus release pending", () => {
	it("carries the publishing backlog as report material, non-zero exit and all", async () => {
		const result = await runCycleStatus(
			baseDeps({
				shTry: (_file, args) => {
					assert.ok(args[0].endsWith("scripts/release-status.mjs"));
					return {
						ok: false,
						status: 1,
						out: "release-status:\n@pfdsl/cli 0.0.25 (37 commits ahead)\n",
					};
				},
			}),
		);
		assert.deepEqual(result.releasePending, {
			needsAction: true,
			report: ["release-status:", "@pfdsl/cli 0.0.25 (37 commits ahead)"],
		});
	});

	it("sets releasePendingError and leaves the field null when the runner throws", async () => {
		const result = await runCycleStatus(
			baseDeps({
				shTry: () => {
					throw new Error("spawn failed");
				},
			}),
		);
		assert.equal(result.releasePending, null);
		assert.equal(result.releasePendingError, "spawn failed");
	});
});

describe("runCycleStatus — unregistered flow:managed target issue (#963)", () => {
	const issueJsonWithLabels = (labels) =>
		JSON.stringify({ body: "普通の説明文。", comments: [], labels });

	it("names a flow:managed target issue that has no process in the roadmap", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [956],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJsonWithLabels([{ name: "flow:managed" }]);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.unregisteredManagedIssues, [956]);
		assert.equal(result.gateCheckCommand, null);
		assert.equal(
			result.gateCheckCommandError,
			"issue 956 is flow:managed but has no process in .pfdsl/roadmap.pfdsl",
		);
	});

	it("stays quiet for a flow:exempt target issue", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [963],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJsonWithLabels([{ name: "flow:exempt" }]);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.unregisteredManagedIssues, []);
	});

	it("does not attach a resolved artifact to a mixed set containing an unregistered managed issue", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [42, 956],
				sh: (_file, args) => {
					if (args.includes("neighbors")) throw new Error("should not resolve");
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] !== "issue") return JSON.stringify([]);
					const labels = args[2] === "956" ? [{ name: "flow:managed" }] : [];
					return issueJsonWithLabels(labels);
				},
			}),
		);
		assert.equal(result.gateCheckCommand, null);
		assert.equal(
			result.gateCheckCommandError,
			"issue 956 is flow:managed but has no process in .pfdsl/roadmap.pfdsl",
		);
	});

	it("stays quiet when the managed issue already has a tracked process", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [42],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJsonWithLabels([{ name: "flow:managed" }]);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.unregisteredManagedIssues, []);
	});
});

describe("runCycleStatus — untriaged target issue (#983)", () => {
	const issueJsonWithLabels = (labels) =>
		JSON.stringify({ body: "普通の説明文。", comments: [], labels });

	it("names a target issue with no flow labels and no tracked process", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [983],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJsonWithLabels([]);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.untriagedTargetIssues, [983]);
	});

	for (const label of ["flow:managed", "flow:exempt"]) {
		it(`stays quiet for a target issue labelled ${label}`, async () => {
			const result = await runCycleStatus(
				baseDeps({
					issueNumbers: [983],
					sh: (_file, args) => {
						if (args.includes(CLI_PATH)) return readyJsonOk(null);
						return "";
					},
					readFileSync: () => roadmapWithIssue("proc_a", 42),
					execGh: async (args) => {
						if (args[0] === "issue")
							return issueJsonWithLabels([{ name: label }]);
						return JSON.stringify([]);
					},
				}),
			);
			assert.deepEqual(result.untriagedTargetIssues, []);
		});
	}

	it("stays quiet when the target issue already has a tracked process", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [42],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJsonWithLabels([]);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.untriagedTargetIssues, []);
	});
});

describe("runCycleStatus — issue lookup failure and unregisteredManagedIssues", () => {
	it("retains every issue lookup failure in the blocking display reason", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [956, 957],
				execGh: async (args) => {
					if (args[0] === "issue")
						throw new Error(`lookup failed for ${args[2]}`);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.issueLookupFailures, [
			{ issue: 956, error: "lookup failed for 956" },
			{ issue: 957, error: "lookup failed for 957" },
		]);
		assert.match(result.designUnsettledError, /956.*lookup failed for 956/);
		assert.match(result.designUnsettledError, /957.*lookup failed for 957/);
		assert.equal(result.blocking, true);
	});

	it("excludes an issue whose label lookup failed, and says so via designUnsettledError", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [956],
				sh: (_file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue") throw new Error("gh: network unreachable");
					return JSON.stringify([]);
				},
			}),
		);
		// Reporting it as unregistered would be a false positive (its labels are
		// unknown); reporting nothing at all would hide that the check never ran.
		assert.deepEqual(result.unregisteredManagedIssues, []);
		assert.deepEqual(result.untriagedTargetIssues, []);
		assert.match(result.designUnsettledError, /network unreachable/);
		assert.deepEqual(result.issueLookupFailures, [
			{ issue: 956, error: "gh: network unreachable" },
		]);
		assert.equal(result.blocking, true);
	});
});
