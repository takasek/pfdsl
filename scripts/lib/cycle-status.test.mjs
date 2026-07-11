import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	classifyPRs,
	parseReadyOutput,
	countBehind,
	summarizeCiStatus,
	detectDesignUnsettled,
	findIssueNumberForProcess,
} from "./cycle-status.mjs";

describe("summarizeCiStatus", () => {
	it("returns NONE for empty/missing rollup", () => {
		assert.equal(summarizeCiStatus([]), "NONE");
		assert.equal(summarizeCiStatus(undefined), "NONE");
	});

	it("returns PASS when all checks succeeded", () => {
		assert.equal(summarizeCiStatus([{ conclusion: "SUCCESS" }, { conclusion: "SUCCESS" }]), "PASS");
	});

	it("returns FAIL when any check failed", () => {
		assert.equal(summarizeCiStatus([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]), "FAIL");
	});

	it("returns PENDING when any check is still running", () => {
		assert.equal(summarizeCiStatus([{ conclusion: null, status: "IN_PROGRESS" }]), "PENDING");
	});

	it("FAIL takes precedence over PENDING", () => {
		assert.equal(summarizeCiStatus([{ conclusion: "FAILURE" }, { conclusion: null }]), "FAIL");
	});
});

describe("classifyPRs", () => {
	it("splits flow-sync PRs from other open PRs", () => {
		const prs = [
			{ number: 1, title: "flow sync", headRefName: "flow-sync/2026-07-06" },
			{ number: 2, title: "feature work", headRefName: "feat/foo" },
		];
		const { openFlowSyncPRs, otherOpenPRs } = classifyPRs(prs);
		assert.deepEqual(openFlowSyncPRs, [{ number: 1, title: "flow sync", ci: "NONE" }]);
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
		assert.deepEqual(openFlowSyncPRs, [{ number: 1, title: "flow sync", ci: "PASS" }]);
	});

	it("returns empty lists for no PRs", () => {
		assert.deepEqual(classifyPRs([]), { openFlowSyncPRs: [], otherOpenPRs: [] });
	});

	it("accepts a custom flow-sync pattern", () => {
		const prs = [{ number: 3, title: "custom", headRefName: "sync/x" }];
		const { openFlowSyncPRs } = classifyPRs(prs, /^sync\//);
		assert.equal(openFlowSyncPRs.length, 1);
	});
});

describe("parseReadyOutput", () => {
	it("extracts ready ids and best id", () => {
		const json = {
			ok: true,
			ready: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
			best: { id: "a", label: "A" },
		};
		assert.deepEqual(parseReadyOutput(json), { ready: ["a", "b"], best: "a" });
	});

	it("returns empty when ok is false", () => {
		assert.deepEqual(parseReadyOutput({ ok: false }), { ready: [], best: null });
	});

	it("returns empty for missing/invalid input", () => {
		assert.deepEqual(parseReadyOutput(null), { ready: [], best: null });
		assert.deepEqual(parseReadyOutput(undefined), { ready: [], best: null });
	});

	it("returns null best when absent", () => {
		const json = { ok: true, ready: [] };
		assert.deepEqual(parseReadyOutput(json), { ready: [], best: null });
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
		assert.deepEqual(detectDesignUnsettled(""), { designUnsettled: false, matchedLines: [] });
		assert.deepEqual(detectDesignUnsettled(undefined), { designUnsettled: false, matchedLines: [] });
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
		assert.equal(findIssueNumberForProcess(pfdsl, "i405_implement_mint_check"), 405);
	});

	it("does not bleed into a neighboring process's location", () => {
		assert.equal(findIssueNumberForProcess(pfdsl, "i402_implement_get_by_id"), 402);
	});

	it("returns null for an unknown process id", () => {
		assert.equal(findIssueNumberForProcess(pfdsl, "i999_nonexistent"), null);
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
