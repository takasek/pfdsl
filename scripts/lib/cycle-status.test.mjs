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
	findDecisionRecords,
	findIssueNumberForProcess,
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

	it("counts numbered list items under a matching heading, stopping at the next same-level heading", () => {
		const body = [
			"## 検討したい方向",
			"1. 案A: 説明",
			"2. 案B: 説明",
			"",
			"## 次のセクション",
			"1. 関係ない項目",
		].join("\n");
		const result = detectEnumeratedOptions(body);
		assert.equal(result.enumerated, true);
		assert.equal(result.count, 2);
		assert.deepEqual(result.headings, ["## 検討したい方向"]);
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

describe("findDecisionRecords", () => {
	it("collects 決定: 案N lines from entries, tagged with author and createdAt", () => {
		const entries = [
			{ author: "owner", body: "## 概要\n決定: 案2\n" },
			{ author: "other", body: "決定: 案1", createdAt: "2026-01-01T00:00:00Z" },
		];
		assert.deepEqual(findDecisionRecords(entries), [
			{ author: "owner", option: "2", line: "決定: 案2", createdAt: undefined },
			{
				author: "other",
				option: "1",
				line: "決定: 案1",
				createdAt: "2026-01-01T00:00:00Z",
			},
		]);
	});

	it("recognizes a decision line under the same decoration its sibling line heads allow", () => {
		const decorated = [
			{ author: "owner", body: "> - **決定：** 案2" },
			{ author: "owner", body: "## 決定（最終）: 案3" },
		];
		assert.deepEqual(
			findDecisionRecords(decorated).map((r) => r.option),
			["2", "3"],
		);
	});

	it("returns an empty array when no entry contains a 決定: line", () => {
		assert.deepEqual(
			findDecisionRecords([{ author: "owner", body: "まだ検討中。" }]),
			[],
		);
	});

	it("returns an empty array for no entries", () => {
		assert.deepEqual(findDecisionRecords([]), []);
	});
});

describe("classifyDesignSettlement", () => {
	it("reports unsettled by phrase before checking for a recorded decision", () => {
		const result = classifyDesignSettlement({
			body: "設計未確定な点がある。",
			ownerLogin: "owner",
			comments: [{ author: "owner", body: "決定: 案1" }],
		});
		assert.equal(result.unsettled, true);
		assert.equal(result.reason, "phrase");
		assert.deepEqual(result.matchedLines, ["設計未確定な点がある。"]);
	});

	it("reports settled when the issue owner recorded a decision", () => {
		const result = classifyDesignSettlement({
			body: "## 対応案\n1. 案A\n2. 案B\n",
			ownerLogin: "owner",
			comments: [
				{
					author: "owner",
					body: "決定: 案2",
					createdAt: "2026-01-01T00:00:00Z",
				},
			],
		});
		assert.equal(result.unsettled, false);
		assert.equal(result.reason, "decision-recorded");
		assert.deepEqual(result.decision, {
			author: "owner",
			option: "2",
			createdAt: "2026-01-01T00:00:00Z",
		});
	});

	it("does not accept a decision recorded by someone other than the issue owner", () => {
		const result = classifyDesignSettlement({
			body: "## 対応案\n1. 案A\n2. 案B\n",
			ownerLogin: "owner",
			comments: [{ author: "someone-else", body: "決定: 案2" }],
		});
		assert.equal(result.unsettled, true);
		assert.equal(result.reason, "enumerated-options-without-decision");
		assert.equal(result.optionCount, 2);
	});

	it("reports unsettled when options are enumerated and no decision is recorded", () => {
		const result = classifyDesignSettlement({
			body: "## 選択肢\n1. 案A\n2. 案B\n",
			ownerLogin: "owner",
			comments: [],
		});
		assert.equal(result.unsettled, true);
		assert.equal(result.reason, "enumerated-options-without-decision");
	});

	it("reports settled with no-enumerated-options when nothing indicates unsettled design", () => {
		assert.deepEqual(
			classifyDesignSettlement({
				body: "普通の説明文。",
				ownerLogin: "owner",
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

describe("buildGateCheckCommand", () => {
	it("builds the completed gate-check command line", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main"),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool",
		);
	});

	it("appends --issue when the cycle's issue is known", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main", 669),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool --issue 669",
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

describe("buildDesignRecordTemplate", () => {
	it("emits a skeleton that the terminal gate's own content check accepts", () => {
		const { lines } = buildDesignRecordTemplate({ optionCount: 0 });
		assert.deepEqual(classifyDesignRecordContent(lines.join("\n"), 0), {
			status: "PASS",
		});
	});

	it("omits the 決定 line — that record belongs to the filer, not to the runner", () => {
		const { lines, note } = buildDesignRecordTemplate({ optionCount: 0 });
		assert.deepEqual(
			findDecisionRecords([{ author: "someone", body: lines.join("\n") }]),
			[],
		);
		assert.match(note, /起票者本人が書く/);
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
