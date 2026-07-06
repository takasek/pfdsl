import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPRs, parseReadyOutput, countBehind } from "./cycle-status.mjs";

describe("classifyPRs", () => {
	it("splits flow-sync PRs from other open PRs", () => {
		const prs = [
			{ number: 1, title: "flow sync", headRefName: "flow-sync/2026-07-06" },
			{ number: 2, title: "feature work", headRefName: "feat/foo" },
		];
		const { openFlowSyncPRs, otherOpenPRs } = classifyPRs(prs);
		assert.deepEqual(openFlowSyncPRs, [{ number: 1, title: "flow sync" }]);
		assert.deepEqual(otherOpenPRs, [{ number: 2, title: "feature work" }]);
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

describe("countBehind", () => {
	it("counts non-empty lines", () => {
		assert.equal(countBehind("abc123 commit one\ndef456 commit two\n"), 2);
	});

	it("returns 0 for empty output", () => {
		assert.equal(countBehind(""), 0);
		assert.equal(countBehind("\n"), 0);
	});
});
