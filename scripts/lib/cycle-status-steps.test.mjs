import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCycleStatus } from "./cycle-status-steps.mjs";

const ROOT = "/repo";
const CLI_PATH = "/repo/packages/cli/dist/cli.js";
const ROADMAP_PATH = "/repo/.pfdsl/roadmap.pfdsl";

const readyJsonOk = (best) =>
	JSON.stringify({
		ok: true,
		ready: [{ id: "a" }],
		best: best ? { id: best, outputs: [`${best}_out`] } : undefined,
	});

const roadmapWithIssue = (processId, issueNumber) =>
	`processes:\n  ${processId}:\n    label: x\n    location: https://github.com/takasek/pfdsl/issues/${issueNumber}\nartifacts:\n`;

function baseDeps(overrides = {}) {
	return {
		sh: () => "",
		execGh: async () => JSON.stringify([]),
		existsSync: () => true,
		readFileSync: () => "",
		root: ROOT,
		base: "main",
		...overrides,
	};
}

describe("runCycleStatus", () => {
	it("reports fetched:false when git fetch throws, without aborting the rest", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
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
				sh: (file, args) => {
					if (args.includes("log")) throw new Error("fatal: bad revision");
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
				sh: (file, args) => {
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
		assert.ok(!calls.some(([, args]) => args.includes(CLI_PATH)));
		assert.deepEqual(ghCalls, []);
	});

	it("sets prError and empty PR lists when gh pr list fails", async () => {
		const result = await runCycleStatus(
			baseDeps({
				execGh: async () => {
					throw new Error("gh: not authenticated");
				},
			}),
		);
		assert.deepEqual(result.openFlowSyncPRs, []);
		assert.deepEqual(result.otherOpenPRs, []);
		assert.equal(result.prError, "gh: not authenticated");
	});

	it("classifies PRs on success", async () => {
		const result = await runCycleStatus(
			baseDeps({
				execGh: async (args) => {
					if (args[0] === "pr") {
						return JSON.stringify([
							{ number: 1, title: "sync", headRefName: "flow-sync/x" },
						]);
					}
					return "";
				},
			}),
		);
		assert.deepEqual(result.otherOpenPRs, []);
		assert.equal(result.openFlowSyncPRs.length, 1);
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
				sh: (file, args) => {
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
				sh: (file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
			}),
		);
		assert.deepEqual(result.ready, ["a"]);
		assert.equal(result.best, null);
	});

	const issueJson = ({ author, body, comments = [] }) =>
		JSON.stringify({ author: { login: author }, body, comments });

	it("resolves the target issue from --issue when given, ignoring any best process", async () => {
		const calls = [];
		const result = await runCycleStatus(
			baseDeps({
				issueNumber: 669,
				sh: (file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					calls.push(args);
					if (args[0] === "issue")
						return issueJson({ author: "owner", body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.designUnsettledFor, {
			issue: 669,
			source: "flag",
			unsettled: false,
			reason: "no-enumerated-options",
			matchedLines: [],
			optionCount: 0,
			decision: null,
		});
		assert.equal(result.designUnsettledError, undefined);
		assert.ok(calls.some((c) => c[0] === "issue" && c.includes("669")));
		assert.ok(!calls.some((c) => c[0] === "issue" && c.includes("42")));
	});

	it("resolves the target issue from the best process when --issue is absent", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue")
						return issueJson({
							author: "owner",
							body: "設計未確定な点がある。",
						});
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designUnsettledFor.issue, 42);
		assert.equal(result.designUnsettledFor.source, "best-process");
		assert.equal(result.designUnsettledFor.unsettled, true);
		assert.equal(result.designUnsettledFor.reason, "phrase");
	});

	it("reports the current branch and how far HEAD leads the base", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
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
				sh: (file, args) => {
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

	it("emits the design-record template with the issue's enumerated option count", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumber: 721,
				execGh: async (args) => {
					if (args[0] === "issue") {
						return issueJson({
							author: "owner",
							body: "## 検討したい方向\n1. 案A\n2. 案B\n3. 案C\n",
						});
					}
					return JSON.stringify([]);
				},
			}),
		);
		const dispositionLine = result.designRecordTemplate.lines.find((l) =>
			l.includes("処分"),
		);
		assert.match(dispositionLine, /3/);
	});

	it("emits the design-record template even when no issue could be resolved", async () => {
		const result = await runCycleStatus(baseDeps({}));
		assert.equal(result.designUnsettledFor, null);
		assert.ok(result.designRecordTemplate.lines.length > 0);
		assert.equal(
			result.designRecordTemplate.lines.some((l) => l.includes("処分")),
			false,
		);
	});

	it("returns a null designUnsettledFor with an error when neither --issue nor a best process is available", async () => {
		const calls = [];
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				execGh: async (args) => {
					calls.push(args);
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designUnsettledFor, null);
		assert.equal(
			result.designUnsettledError,
			"no --issue given and no best process to resolve an issue number from",
		);
		assert.ok(!calls.some((c) => c[0] === "issue"));
	});

	it("returns a null designUnsettledFor with the roadmap error when the best process has no issue number", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => "processes:\n  proc_a:\n    label: x\n",
			}),
		);
		assert.equal(result.designUnsettledFor, null);
		assert.equal(
			result.designUnsettledError,
			"no issue number found for process 'proc_a' in .pfdsl/roadmap.pfdsl",
		);
	});

	it("returns a null designUnsettledFor with the gh error when the gh issue lookup throws", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumber: 669,
				execGh: async (args) => {
					if (args[0] === "issue") throw new Error("gh: issue not found");
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.designUnsettledFor, null);
		assert.equal(result.designUnsettledError, "gh: issue not found");
	});

	it("selects the first best output for the gate-check command", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
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
	});

	it("returns a null gate-check command when there is no best process", async () => {
		const result = await runCycleStatus(baseDeps());
		assert.equal(result.gateCheckCommand, null);
	});
});
