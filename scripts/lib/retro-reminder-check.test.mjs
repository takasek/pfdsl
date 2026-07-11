import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectDoneAddition } from "./retro-reminder-check.mjs";

describe("detectDoneAddition", () => {
	it("detects an added status: done line", () => {
		const diff = [
			"diff --git a/.pfdsl/roadmap.pfdsl b/.pfdsl/roadmap.pfdsl",
			"@@ -1,3 +1,3 @@",
			"   foo:",
			"-    status: todo",
			"+    status: done",
		].join("\n");
		assert.equal(detectDoneAddition(diff), true);
	});

	it("ignores unrelated added lines", () => {
		const diff = [
			"diff --git a/.pfdsl/roadmap.pfdsl b/.pfdsl/roadmap.pfdsl",
			"@@ -1,2 +1,2 @@",
			"+  label: something",
		].join("\n");
		assert.equal(detectDoneAddition(diff), false);
	});

	it("ignores removed status: done lines (only additions count)", () => {
		const diff = [
			"diff --git a/.pfdsl/roadmap.pfdsl b/.pfdsl/roadmap.pfdsl",
			"@@ -1,2 +1,2 @@",
			"-    status: done",
			"+    status: wip",
		].join("\n");
		assert.equal(detectDoneAddition(diff), false);
	});

	it("ignores the diff file header lines (+++ b/...)", () => {
		const diff = [
			"--- a/.pfdsl/roadmap.pfdsl",
			"+++ b/.pfdsl/roadmap.pfdsl",
			"@@ -1,1 +1,1 @@",
			"+  other: value",
		].join("\n");
		assert.equal(detectDoneAddition(diff), false);
	});

	it("returns false for an empty diff", () => {
		assert.equal(detectDoneAddition(""), false);
	});
});
