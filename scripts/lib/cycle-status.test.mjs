import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildDesignRecordTemplate,
	buildGateCheckCommand,
	classifyDesignSettlement,
	classifyPRs,
	countBehind,
	detectDesignUnsettled,
	detectEnumeratedOptions,
	findIssueNumberForProcess,
	findProcessIdForIssueNumber,
	parsePorcelainPaths,
	parseReadyOutput,
	summarizeCiStatus,
} from "./cycle-status.mjs";
import {
	classifyDesignRecordContent,
	selectDesignRecord,
} from "./gate-check.mjs";

describe("summarizeCiStatus", () => {
	it("returns NONE for empty/missing rollup", () => {
		assert.equal(summarizeCiStatus([]), "NONE");
		assert.equal(summarizeCiStatus(undefined), "NONE");
	});

	it("returns PASS when all checks succeeded", () => {
		assert.equal(
			summarizeCiStatus([{ conclusion: "SUCCESS" }, { conclusion: "SUCCESS" }]),
			"PASS",
		);
	});

	it("returns FAIL when any check failed", () => {
		assert.equal(
			summarizeCiStatus([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]),
			"FAIL",
		);
	});

	it("returns PENDING when any check is still running", () => {
		assert.equal(
			summarizeCiStatus([{ conclusion: null, status: "IN_PROGRESS" }]),
			"PENDING",
		);
	});

	it("FAIL takes precedence over PENDING", () => {
		assert.equal(
			summarizeCiStatus([{ conclusion: "FAILURE" }, { conclusion: null }]),
			"FAIL",
		);
	});
});

describe("classifyPRs", () => {
	it("splits flow-sync PRs from other open PRs", () => {
		const prs = [
			{ number: 1, title: "flow sync", headRefName: "flow-sync/2026-07-06" },
			{ number: 2, title: "feature work", headRefName: "feat/foo" },
		];
		const { openFlowSyncPRs, otherOpenPRs } = classifyPRs(prs);
		assert.deepEqual(openFlowSyncPRs, [
			{ number: 1, title: "flow sync", ci: "NONE" },
		]);
		assert.deepEqual(otherOpenPRs, [{ number: 2, title: "feature work" }]);
	});

	it("includes CI status on flow-sync PRs from statusCheckRollup", () => {
		const prs = [
			{
				number: 1,
				title: "flow sync",
				headRefName: "flow-sync/2026-07-06",
				statusCheckRollup: [{ conclusion: "SUCCESS" }],
			},
		];
		const { openFlowSyncPRs } = classifyPRs(prs);
		assert.deepEqual(openFlowSyncPRs, [
			{ number: 1, title: "flow sync", ci: "PASS" },
		]);
	});

	it("returns empty lists for no PRs", () => {
		assert.deepEqual(classifyPRs([]), {
			openFlowSyncPRs: [],
			otherOpenPRs: [],
		});
	});

	it("accepts a custom flow-sync pattern", () => {
		const prs = [{ number: 3, title: "custom", headRefName: "sync/x" }];
		const { openFlowSyncPRs } = classifyPRs(prs, /^sync\//);
		assert.equal(openFlowSyncPRs.length, 1);
	});
});

describe("parseReadyOutput", () => {
	it("extracts ready ids, best id, and best outputs", () => {
		const json = {
			ok: true,
			ready: [
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
			],
			best: { id: "a", label: "A", outputs: ["a_out"] },
		};
		assert.deepEqual(parseReadyOutput(json), {
			ready: ["a", "b"],
			best: "a",
			bestOutputs: ["a_out"],
		});
	});

	it("returns empty when ok is false", () => {
		assert.deepEqual(parseReadyOutput({ ok: false }), {
			ready: [],
			best: null,
			bestOutputs: [],
		});
	});

	it("returns empty for missing/invalid input", () => {
		assert.deepEqual(parseReadyOutput(null), {
			ready: [],
			best: null,
			bestOutputs: [],
		});
		assert.deepEqual(parseReadyOutput(undefined), {
			ready: [],
			best: null,
			bestOutputs: [],
		});
	});

	it("returns null best and empty bestOutputs when absent", () => {
		const json = { ok: true, ready: [] };
		assert.deepEqual(parseReadyOutput(json), {
			ready: [],
			best: null,
			bestOutputs: [],
		});
	});
});

describe("detectDesignUnsettled", () => {
	it("returns false for a body with no unsettled-design phrases", () => {
		assert.deepEqual(detectDesignUnsettled("実装方針は A に決定。"), {
			designUnsettled: false,
			matchedLines: [],
		});
	});

	it("detects '設計未確定' and returns the matched line", () => {
		const body = "## 概要\n設計未確定な点がある。\n続き";
		assert.deepEqual(detectDesignUnsettled(body), {
			designUnsettled: true,
			matchedLines: ["設計未確定な点がある。"],
		});
	});

	it("detects 'design TBD' case-insensitively", () => {
		const body = "Approach: design TBD, need discussion";
		const { designUnsettled, matchedLines } = detectDesignUnsettled(body);
		assert.equal(designUnsettled, true);
		assert.deepEqual(matchedLines, ["Approach: design TBD, need discussion"]);
	});

	it("returns false for empty/missing body", () => {
		assert.deepEqual(detectDesignUnsettled(""), {
			designUnsettled: false,
			matchedLines: [],
		});
		assert.deepEqual(detectDesignUnsettled(undefined), {
			designUnsettled: false,
			matchedLines: [],
		});
	});
});

describe("detectEnumeratedOptions", () => {
	it("returns not enumerated for a body without an option heading", () => {
		assert.deepEqual(detectEnumeratedOptions("ただの説明文。"), {
			enumerated: false,
			count: 0,
			headings: [],
		});
	});

	// Since #800, every heading is a scan origin (not only vocabulary-matched
	// ones), so a later heading is now itself pushed into `headings` too — it is
	// no longer excluded just for not matching a fixed vocabulary. What this test
	// still demonstrates: the first heading's scan stops at the next heading, so
	// content past that boundary is not attributed back to the first heading's
	// count.
	it("counts numbered list items under a heading, stopping at the next same-level heading", () => {
		const body = [
			"## 検討したい方向",
			"1. 案A: 説明",
			"2. 案B: 説明",
			"",
			"## 次のセクション",
			"関係ない説明文。",
		].join("\n");
		const result = detectEnumeratedOptions(body);
		assert.equal(result.enumerated, true);
		assert.equal(result.count, 2);
		assert.deepEqual(result.headings, [
			"## 検討したい方向",
			"## 次のセクション",
		]);
	});

	it("counts labeled sub-headings under a matching heading", () => {
		const body = [
			"## 対応案",
			"### A. 最小案",
			"本文",
			"### B. 拡張案",
			"本文",
		].join("\n");
		const result = detectEnumeratedOptions(body);
		assert.equal(result.enumerated, true);
		assert.equal(result.count, 2);
	});

	it("does not enumerate when only one candidate item is found", () => {
		assert.equal(
			detectEnumeratedOptions("## 選択肢\n1. ひとつだけ").enumerated,
			false,
		);
	});

	// #800: the vocabulary allowlist that previously gated which headings counted
	// (検討したい方向/対応案/方針案/選択肢 only) is gone. Any markdown heading now
	// starts a scan, regardless of wording — a filer whose heading uses different
	// words (e.g. "対応の方向", issue #774's actual case) is no longer missed.
	it("counts items under a heading whose wording is not in any fixed vocabulary", () => {
		const body = ["## 対応の方向", "1. 案A: 説明", "2. 案B: 説明"].join("\n");
		const result = detectEnumeratedOptions(body);
		assert.equal(result.enumerated, true);
		assert.equal(result.count, 2);
	});

	// #772: a bullet-list option label ("- 案A: ..." / "- 案1: ..." / "- A: ...")
	// is a candidate-enumeration shape the numbered-item and labeled-subheading
	// patterns both miss.
	it("counts labeled bullet items under a heading", () => {
		const body = ["## 対応案", "- 案A: 最小案", "- 案B: 拡張案"].join("\n");
		const result = detectEnumeratedOptions(body);
		assert.equal(result.enumerated, true);
		assert.equal(result.count, 2);
	});

	// Allowlist removal is a deliberate scope widening, not a side effect: a
	// heading followed by an ordinary step-by-step procedure now also reads as
	// "enumerated options", even though it names no design choice. This false
	// positive is an accepted tradeoff — a human glances at it once and moves on
	// — against the false negative the allowlist produced when a filer's wording
	// fell outside the fixed vocabulary (see
	// .pfdsl/bindings/pfd-retro-patterns/unmatched-vocabulary-defaults-to-pass.md).
	it("also enumerates a plain step-by-step procedure under a heading (accepted false positive)", () => {
		const body = ["## 実装手順", "1. ステップ1", "2. ステップ2"].join("\n");
		const result = detectEnumeratedOptions(body);
		assert.equal(result.enumerated, true);
		assert.equal(result.count, 2);
	});

	it("returns not enumerated for empty/missing body", () => {
		assert.deepEqual(detectEnumeratedOptions(""), {
			enumerated: false,
			count: 0,
			headings: [],
		});
		assert.deepEqual(detectEnumeratedOptions(undefined), {
			enumerated: false,
			count: 0,
			headings: [],
		});
	});
});

describe("classifyDesignSettlement", () => {
	it("reports unsettled by phrase before checking for a posted record", () => {
		const result = classifyDesignSettlement({
			body: "設計未確定な点がある。",
			comments: [{ author: "runner", body: "前提: x\n否定案: y\n却下理由: z" }],
		});
		assert.equal(result.unsettled, true);
		assert.equal(result.reason, "phrase");
		assert.deepEqual(result.matchedLines, ["設計未確定な点がある。"]);
	});

	it("reports settled when a design-selection record was posted", () => {
		const result = classifyDesignSettlement({
			body: "## 対応案\n1. 案A\n2. 案B\n",
			comments: [
				{
					author: "runner",
					body: "前提: x\n否定案: y\n却下理由: z",
					createdAt: "2026-01-01T00:00:00Z",
				},
			],
		});
		assert.equal(result.unsettled, false);
		assert.equal(result.reason, "record-posted");
		assert.deepEqual(result.record, {
			author: "runner",
			createdAt: "2026-01-01T00:00:00Z",
		});
	});

	it("reports unsettled when options are enumerated and no record was posted", () => {
		const result = classifyDesignSettlement({
			body: "## 選択肢\n1. 案A\n2. 案B\n",
			comments: [],
		});
		assert.equal(result.unsettled, true);
		assert.equal(result.reason, "enumerated-options-without-record");
		assert.equal(result.optionCount, 2);
	});

	it("reports settled with no-enumerated-options when nothing indicates unsettled design", () => {
		assert.deepEqual(
			classifyDesignSettlement({
				body: "普通の説明文。",
				comments: [],
			}),
			{
				unsettled: false,
				reason: "no-enumerated-options",
			},
		);
	});
});

describe("findIssueNumberForProcess", () => {
	const pfdsl = `artifacts:
  spec_id_syntax:
    label: 仕様ID構文
processes:
  i402_implement_get_by_id:
    label: get-by-ID ツール実装
    location: https://github.com/takasek/pfdsl/issues/402
  i405_implement_mint_check:
    label: mint-check ツール実装
    location: https://github.com/takasek/pfdsl/issues/405
    updated_at: 2026-07-10T01:50:30Z
  i435_implement_ansi_color:
    label: 診断 ANSI カラー実装
    location: https://github.com/takasek/pfdsl/issues/435
`;

	it("extracts the issue number from the process block's location", () => {
		assert.equal(
			findIssueNumberForProcess(pfdsl, "i405_implement_mint_check"),
			405,
		);
	});

	it("does not bleed into a neighboring process's location", () => {
		assert.equal(
			findIssueNumberForProcess(pfdsl, "i402_implement_get_by_id"),
			402,
		);
	});

	it("returns null for an unknown process id", () => {
		assert.equal(findIssueNumberForProcess(pfdsl, "i999_nonexistent"), null);
	});
});

describe("findProcessIdForIssueNumber", () => {
	// The top-level key is the singular `process:`, matching the real
	// .pfdsl/roadmap.pfdsl (confirmed by reading the file directly — an earlier
	// version of this task's brief assumed a plural `processes:` key and a
	// per-process `outputs:` field, neither of which exists there).
	const pfdsl = `artifact:
  spec_id_syntax:
    label: 仕様ID構文
    location: https://github.com/takasek/pfdsl/issues/999
process:
  i402_implement_get_by_id:
    label: get-by-ID ツール実装
    location: https://github.com/takasek/pfdsl/issues/402
  i405_implement_mint_check:
    label: mint-check ツール実装
    location: https://github.com/takasek/pfdsl/issues/405
    updated_at: 2026-07-10T01:50:30Z
  i435_implement_ansi_color:
    label: 診断 ANSI カラー実装
    location: https://github.com/takasek/pfdsl/issues/435
tag:
  some_tag: {}
`;

	it("returns the processId whose location matches the issue number", () => {
		assert.equal(
			findProcessIdForIssueNumber(pfdsl, 405),
			"i405_implement_mint_check",
		);
	});

	it("does not bleed into a neighboring process's location", () => {
		assert.equal(
			findProcessIdForIssueNumber(pfdsl, 402),
			"i402_implement_get_by_id",
		);
	});

	it("resolves the last process entry in the section, proving the section boundary (before tag:) is handled", () => {
		assert.equal(
			findProcessIdForIssueNumber(pfdsl, 435),
			"i435_implement_ansi_color",
		);
	});

	it("does not match an issue number that only appears in the artifact section", () => {
		// issue 999 is only referenced from spec_id_syntax's location, in
		// artifact:, not process:. A naive scan across the whole file would wrongly
		// resolve this.
		assert.equal(findProcessIdForIssueNumber(pfdsl, 999), null);
	});

	it("returns null for an issue number with no matching process at all", () => {
		assert.equal(findProcessIdForIssueNumber(pfdsl, 1), null);
	});
});

describe("buildGateCheckCommand", () => {
	it("builds the completed gate-check command line", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main"),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool",
		);
	});

	it("appends --issue when the cycle's issue is known", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main", [669]),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool --issue 669",
		);
	});

	it("repeats --issue for every issue the cycle closes", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main", [667, 668]),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool --issue 667 --issue 668",
		);
	});

	it("omits --issue when no issue is known", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main", []),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool",
		);
	});

	it("returns null when artifactKey is missing", () => {
		assert.equal(buildGateCheckCommand(null, "main"), null);
	});
});

describe("countBehind", () => {
	it("counts non-empty lines", () => {
		assert.equal(countBehind("abc123 commit one\ndef456 commit two\n"), 2);
	});

	it("returns 0 for empty output", () => {
		assert.equal(countBehind(""), 0);
		assert.equal(countBehind("\n"), 0);
	});
});

describe("parsePorcelainPaths", () => {
	it("returns the path of every entry, tracked or not", () => {
		assert.deepEqual(
			parsePorcelainPaths(
				" M scripts/gate-check.mjs\n?? notes.txt\nA  x.mjs\n",
			),
			["scripts/gate-check.mjs", "notes.txt", "x.mjs"],
		);
	});

	it("returns an empty list for a clean tree", () => {
		assert.deepEqual(parsePorcelainPaths(""), []);
		assert.deepEqual(parsePorcelainPaths("\n"), []);
	});

	// A rename is one entry naming two paths. The destination is where the
	// content sits now, so that is the path a reader has to deal with.
	it("takes the destination of a rename", () => {
		assert.deepEqual(parsePorcelainPaths("R  old.mjs -> new.mjs\n"), [
			"new.mjs",
		]);
	});

	// Porcelain v1 pads the status to two columns, so a path is never shorter
	// than its line minus three — but a path containing " -> " outside a rename
	// entry would be split by a naive replace.
	it("keeps a space-bearing path intact", () => {
		assert.deepEqual(parsePorcelainPaths("?? docs/a b.md\n"), ["docs/a b.md"]);
	});
});

describe("buildDesignRecordTemplate", () => {
	it("emits a skeleton that the terminal gate's own content check accepts", () => {
		const { lines } = buildDesignRecordTemplate({ optionCount: 0 });
		assert.deepEqual(classifyDesignRecordContent(lines.join("\n"), 0), {
			status: "PASS",
		});
	});

	it("emits a skeleton the gate identifies as the selection record", () => {
		const { lines } = buildDesignRecordTemplate({ optionCount: 0 });
		const entries = [
			{ author: "filer", body: "普通の説明文。" },
			{ author: "runner", body: lines.join("\n") },
		];
		assert.equal(selectDesignRecord(entries)?.author, "runner");
	});

	it("adds a disposition line naming the enumerated option count", () => {
		const { lines } = buildDesignRecordTemplate({ optionCount: 3 });
		const dispositionLine = lines.find((l) => l.includes("処分"));
		assert.ok(dispositionLine, "expected a disposition line");
		assert.match(dispositionLine, /3/);
	});

	it("omits the disposition line when the issue enumerates no options", () => {
		const { lines } = buildDesignRecordTemplate({ optionCount: 0 });
		assert.equal(
			lines.some((l) => l.includes("処分")),
			false,
		);
	});

	it("carries a note explaining that the line heads are machine-matched", () => {
		const { note } = buildDesignRecordTemplate({ optionCount: 0 });
		assert.match(note, /gate-check/);
	});
});
