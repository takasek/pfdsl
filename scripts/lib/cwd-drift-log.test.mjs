import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDriftLogLine } from "./cwd-drift-log.mjs";

describe("buildDriftLogLine", () => {
	it("records a match as timestamp/payloadCwd/processCwd/true, with empty trailing command/response columns when absent", () => {
		const input = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			cwd: "/repo",
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "2026-08-11T00:00:00.000Z",
		});
		assert.equal(line, "2026-08-11T00:00:00.000Z\t/repo\t/repo\ttrue\t\t");
	});

	it("records a mismatch as false", () => {
		const input = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			cwd: "/some/worktree",
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "2026-08-11T00:00:00.000Z",
		});
		assert.equal(
			line,
			"2026-08-11T00:00:00.000Z\t/some/worktree\t/repo\tfalse\t\t",
		);
	});

	it("still produces a 6-column line for malformed JSON, with empty payload cwd/command/response", () => {
		const line = buildDriftLogLine("not json{{{", {
			processCwd: "/repo",
			now: () => "2026-08-11T00:00:00.000Z",
		});
		assert.equal(line, "2026-08-11T00:00:00.000Z\t\t/repo\tfalse\t\t");
	});

	it("still produces a 6-column line when the payload has no cwd field", () => {
		const input = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "2026-08-11T00:00:00.000Z",
		});
		assert.equal(line, "2026-08-11T00:00:00.000Z\t\t/repo\tfalse\t\t");
	});

	it("uses the injected `now` for the timestamp column, not the wall clock", () => {
		const input = JSON.stringify({ cwd: "/repo" });
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "SENTINEL-TIMESTAMP",
		});
		assert.equal(line.split("\t")[0], "SENTINEL-TIMESTAMP");
	});

	it("carries the command and a string tool_response verbatim in the trailing columns — the actual measurement signal, since payload.cwd and process.cwd() may share the same harness-reported origin", () => {
		const input = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			cwd: "/repo",
			tool_input: { command: "pwd" },
			tool_response: "/actual/shell/cwd\n",
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "2026-08-11T00:00:00.000Z",
		});
		assert.equal(
			line,
			"2026-08-11T00:00:00.000Z\t/repo\t/repo\ttrue\tpwd\t/actual/shell/cwd",
		);
	});

	it("reads tool_response.stdout when tool_response is an object with stdout", () => {
		const input = JSON.stringify({
			cwd: "/repo",
			tool_input: { command: "pwd" },
			tool_response: { stdout: "/actual/shell/cwd" },
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t")[5], "/actual/shell/cwd");
	});

	it("falls back to tool_response.output when there is no stdout field", () => {
		const input = JSON.stringify({
			cwd: "/repo",
			tool_response: { output: "/actual/shell/cwd" },
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t")[5], "/actual/shell/cwd");
	});

	it("prefers stdout over output when both are present", () => {
		const input = JSON.stringify({
			cwd: "/repo",
			tool_response: { stdout: "from-stdout", output: "from-output" },
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t")[5], "from-stdout");
	});

	it("collapses tabs and newlines in the command column to a single space, so a line stays one record", () => {
		const input = JSON.stringify({
			cwd: "/repo",
			tool_input: { command: "echo a\t&&\necho b" },
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t")[4], "echo a && echo b");
	});

	it("collapses tabs and newlines in the response column to a single space", () => {
		const input = JSON.stringify({
			cwd: "/repo",
			tool_response: "line one\nline\ttwo",
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t")[5], "line one line two");
	});

	it("truncates the response column to 200 characters", () => {
		const long = "x".repeat(500);
		const input = JSON.stringify({ cwd: "/repo", tool_response: long });
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t")[5], "x".repeat(200));
	});

	it("does not throw and still returns 6 columns when tool_response is absent", () => {
		const input = JSON.stringify({ cwd: "/repo", tool_input: {} });
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t").length, 6);
		assert.equal(line.split("\t")[5], "");
	});

	it("does not throw and still returns 6 columns when tool_response is an unrecognised shape (number)", () => {
		const input = JSON.stringify({ cwd: "/repo", tool_response: 42 });
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t").length, 6);
		assert.equal(line.split("\t")[5], "");
	});

	it("does not throw and still returns 6 columns for malformed JSON entirely", () => {
		const line = buildDriftLogLine("{{{not json", {
			processCwd: "/repo",
			now: () => "T",
		});
		assert.equal(line.split("\t").length, 6);
	});
});
