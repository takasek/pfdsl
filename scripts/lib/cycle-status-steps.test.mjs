import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCycleStatus } from "./cycle-status-steps.mjs";

const ROOT = "/repo";
const CLI_PATH = "/repo/packages/cli/dist/cli.js";

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

function baseDeps(overrides = {}) {
	return {
		sh: () => "",
		shTry: () => ({ ok: true, out: "", status: 0 }),
		execGh: async () => JSON.stringify([]),
		existsSync: () => true,
		readFileSync: () => "",
		readdirSync: () => [],
		root: ROOT,
		base: "main",
		...overrides,
	};
}

describe("runCycleStatus", () => {
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

	const issueJson = ({ body, comments = [] }) =>
		JSON.stringify({ body, comments });

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
				unsettled: false,
				reason: "no-enumerated-options",
				matchedLines: [],
				optionCount: 0,
				record: null,
			},
		]);
		assert.equal(result.designUnsettledError, undefined);
		assert.ok(calls.some((c) => c[0] === "issue" && c.includes("669")));
		assert.ok(!calls.some((c) => c[0] === "issue" && c.includes("42")));
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
				[667, false],
				[668, true],
			],
		);
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

	it("emits the design-record template with the issue's enumerated option count", async () => {
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
		const dispositionLine = result.designRecordTemplate.lines.find((l) =>
			l.includes("処分"),
		);
		assert.match(dispositionLine, /3/);
	});

	it("emits the design-record template even when no issue could be resolved", async () => {
		const result = await runCycleStatus(baseDeps({}));
		assert.deepEqual(result.designUnsettledFor, []);
		assert.ok(result.designRecordTemplate.lines.length > 0);
		assert.equal(
			result.designRecordTemplate.lines.some((l) => l.includes("処分")),
			false,
		);
	});

	// #809: unconditional, same posture as designRecordTemplate — whether this
	// cycle will touch packages/ or scripts/ is undecidable at preflight time.
	it("emits the review-record template even when no issue could be resolved", async () => {
		const result = await runCycleStatus(baseDeps({}));
		assert.match(result.reviewRecordTemplate.line, /^Review: tool=/);
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
	});

	// This is the actual shape of #800/#772/#794 themselves: all three are
	// flow:exempt, so none has a roadmap process to resolve an artifact from.
	it("falls back to --no-artifact when the --issue's issue has no roadmap process (exempt issue)", async () => {
		const result = await runCycleStatus(
			baseDeps({
				issueNumbers: [800],
				readFileSync: () => roadmapWithIssue("proc_x", 42),
				execGh: async (args) => {
					if (args[0] === "issue") return issueJson({ body: "普通の説明文。" });
					return JSON.stringify([]);
				},
			}),
		);
		assert.equal(result.gateCheckCommand, null);
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
		assert.equal(result.gateCheckCommand, null);
	});

	it("returns a null gate-check command when there is no best process", async () => {
		const result = await runCycleStatus(baseDeps());
		assert.equal(result.gateCheckCommand, null);
	});
});

describe("runCycleStatus preArtifactPatterns", () => {
	const patternText = (phase) =>
		[
			"---",
			`tags: [target:issue]${phase ? `\nphase: ${phase}` : ""}`,
			"---",
			"",
			"- **名前**: 冒頭の一文。",
			"  対策: 書く前に確認する。",
			"",
		].join("\n");

	it("loads only the phase: pre-artifact pattern files, name/path/countermeasure each", async () => {
		const result = await runCycleStatus(
			baseDeps({
				readdirSync: () => ["a.md", "b.md", "not-a-pattern.txt"],
				readFileSync: (path) => {
					if (path.endsWith("a.md")) return patternText("pre-artifact");
					if (path.endsWith("b.md")) return patternText(undefined);
					throw new Error(`unexpected read: ${path}`);
				},
			}),
		);
		assert.deepEqual(result.preArtifactPatterns, [
			{
				name: "名前",
				path: ".pfdsl/bindings/pfd-retro-patterns/a.md",
				countermeasure: "書く前に確認する。",
			},
		]);
	});

	it("returns an empty list rather than omitting the field when nothing carries the phase", async () => {
		const result = await runCycleStatus(
			baseDeps({
				readdirSync: () => ["a.md"],
				readFileSync: () => patternText(undefined),
			}),
		);
		assert.deepEqual(result.preArtifactPatterns, []);
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
