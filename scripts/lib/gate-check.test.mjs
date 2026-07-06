import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesTrigger, formatGateTable, hasStatusChange, MANUAL_ITEMS } from "./gate-check.mjs";

describe("matchesTrigger", () => {
	it("matches when any file hits the pattern", () => {
		assert.equal(matchesTrigger(["docs/spec/spec.md", "README.md"], /^docs\//), true);
	});

	it("returns false when nothing matches", () => {
		assert.equal(matchesTrigger(["README.md"], /^docs\//), false);
	});

	it("returns false for an empty file list", () => {
		assert.equal(matchesTrigger([], /^docs\//), false);
	});
});

describe("formatGateTable", () => {
	it("renders PASS/FAIL/SKIP rows with symbols", () => {
		const out = formatGateTable([
			{ name: "pfdsl check", status: "PASS" },
			{ name: "gen-skill identity", status: "SKIP", detail: "no skill-source changes" },
			{ name: "audit-issues-flow", status: "FAIL", detail: "diff detected" },
		]);
		assert.match(out, /✓ PASS\s+pfdsl check/);
		assert.match(out, /- SKIP\s+gen-skill identity — no skill-source changes/);
		assert.match(out, /✗ FAIL\s+audit-issues-flow — diff detected/);
	});
});

describe("hasStatusChange", () => {
	it("detects an added status: line", () => {
		const diff = "@@ -1,3 +1,3 @@\n-    status: todo\n+    status: wip\n";
		assert.equal(hasStatusChange(diff), true);
	});

	it("returns false when no status: line changed", () => {
		const diff = "@@ -1,2 +1,2 @@\n-    label: \"old\"\n+    label: \"new\"\n";
		assert.equal(hasStatusChange(diff), false);
	});

	it("ignores the +++/--- file header lines", () => {
		const diff = "--- a/.pfdsl/roadmap.pfdsl\n+++ b/.pfdsl/roadmap.pfdsl\n status: todo\n";
		assert.equal(hasStatusChange(diff), false);
	});

	it("returns false for an empty diff", () => {
		assert.equal(hasStatusChange(""), false);
	});
});

describe("MANUAL_ITEMS", () => {
	it("is a non-empty list of strings", () => {
		assert.ok(MANUAL_ITEMS.length > 0);
		for (const item of MANUAL_ITEMS) assert.equal(typeof item, "string");
	});
});
