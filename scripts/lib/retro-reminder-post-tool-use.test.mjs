import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	isGitCommitCommand,
	detectDoneAddition,
	buildHookOutput,
	isCliEntrypoint,
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

describe("isCliEntrypoint", () => {
	// node resolves symlinks when it builds import.meta.url but leaves argv[1]
	// as typed, so comparing the two verbatim silently reports "not the
	// entrypoint" whenever the invocation path crosses a symlink — the plugin
	// cache under /tmp on macOS, for one. The hook's whole job is a reminder,
	// so the failure mode is silence.
	const realpath = (p) => (p.startsWith("/tmp/") ? p.replace("/tmp/", "/private/tmp/") : p);

	it("recognises the entrypoint when the invocation path crosses a symlink", () => {
		assert.equal(isCliEntrypoint("file:///private/tmp/hooks/h.mjs", "/tmp/hooks/h.mjs", { realpath }), true);
	});

	it("recognises the entrypoint when no symlink is involved", () => {
		assert.equal(isCliEntrypoint("file:///opt/hooks/h.mjs", "/opt/hooks/h.mjs", { realpath }), true);
	});

	it("rejects a different module imported by the entrypoint", () => {
		assert.equal(isCliEntrypoint("file:///opt/hooks/lib.mjs", "/opt/hooks/h.mjs", { realpath }), false);
	});

	it("rejects an absent argv[1]", () => {
		assert.equal(isCliEntrypoint("file:///opt/hooks/h.mjs", undefined, { realpath }), false);
	});

	it("falls back to the verbatim comparison when the path cannot be resolved", () => {
		const throwing = () => {
			throw new Error("ENOENT");
		};
		assert.equal(isCliEntrypoint("file:///opt/hooks/h.mjs", "/opt/hooks/h.mjs", { realpath: throwing }), true);
	});
});

describe("buildHookOutput", () => {
	it("returns a PostToolUse hookSpecificOutput with an advisory additionalContext", () => {
		const output = buildHookOutput();
		assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
		assert.match(output.hookSpecificOutput.additionalContext, /retro/);
	});
});
