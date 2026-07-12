import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	isGitCommitCommand,
	detectDoneAddition,
	buildHookOutput,
} from "../../hooks/retro-reminder-post-tool-use.mjs";

describe("isGitCommitCommand", () => {
	it("matches a plain git commit command", () => {
		assert.equal(isGitCommitCommand("git commit -m 'foo'"), true);
	});

	it("matches git commit as part of a longer command line", () => {
		assert.equal(isGitCommitCommand("git add -A && git commit -m 'foo'"), true);
	});

	it("ignores unrelated git commands", () => {
		assert.equal(isGitCommitCommand("git status"), false);
	});

	it("ignores non-string input", () => {
		assert.equal(isGitCommitCommand(undefined), false);
	});
});

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
		const diff = ["diff --git a/.pfdsl/roadmap.pfdsl b/.pfdsl/roadmap.pfdsl", "+  label: something"].join("\n");
		assert.equal(detectDoneAddition(diff), false);
	});

	it("ignores removed status: done lines (only additions count)", () => {
		const diff = ["-    status: done", "+    status: wip"].join("\n");
		assert.equal(detectDoneAddition(diff), false);
	});

	it("returns false for an empty diff", () => {
		assert.equal(detectDoneAddition(""), false);
	});
});

describe("buildHookOutput", () => {
	it("returns a PostToolUse hookSpecificOutput with an advisory additionalContext", () => {
		const output = buildHookOutput();
		assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
		assert.match(output.hookSpecificOutput.additionalContext, /retro/);
	});
});
