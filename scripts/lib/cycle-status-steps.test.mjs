import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
		assert.equal(result.readyError, "packages/cli/dist/cli.js not built; run 'pnpm -r build' first");
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

	it("parses ready/best from a successful CLI call and skips the design-unsettled lookup when there is no best", async () => {
		const calls = [];
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					calls.push(args);
					if (args.includes(CLI_PATH)) return readyJsonOk(null);
					return "";
				},
				execGh: async (args) => {
					calls.push(["gh", ...args]);
					return JSON.stringify([]);
				},
			}),
		);
		assert.deepEqual(result.ready, ["a"]);
		assert.equal(result.best, null);
		assert.equal(result.designUnsettled, null);
		assert.ok(!calls.some((c) => c.includes("issue")));
	});

	it("looks up the design-unsettled status for the best process when one exists", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue") return "設計未確定な点がある。";
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.best, "proc_a");
		assert.equal(result.designUnsettled, true);
		assert.deepEqual(result.designUnsettledLines, ["設計未確定な点がある。"]);
		assert.equal(result.designUnsettledError, undefined);
	});

	it("sets designUnsettledError when no issue number is found for the best process", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => "processes:\n  proc_a:\n    label: x\n",
			}),
		);
		assert.equal(
			result.designUnsettledError,
			"no issue number found for process 'proc_a' in .pfdsl/roadmap.pfdsl",
		);
		assert.equal(result.designUnsettled, null);
	});

	it("sets designUnsettledError when the gh issue lookup throws", async () => {
		const result = await runCycleStatus(
			baseDeps({
				sh: (file, args) => {
					if (args.includes(CLI_PATH)) return readyJsonOk("proc_a");
					return "";
				},
				readFileSync: () => roadmapWithIssue("proc_a", 42),
				execGh: async (args) => {
					if (args[0] === "issue") throw new Error("gh: issue not found");
					return JSON.stringify([]);
				},
			}),
		);
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
		assert.equal(result.gateCheckCommand, "node scripts/gate-check.mjs --base main --artifact proc_a_out");
	});

	it("returns a null gate-check command when there is no best process", async () => {
		const result = await runCycleStatus(baseDeps());
		assert.equal(result.gateCheckCommand, null);
	});
});
