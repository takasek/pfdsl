import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDriftLogLine } from "./cwd-drift-log.mjs";

describe("buildDriftLogLine", () => {
	it("records a match as a tab-separated timestamp/payloadCwd/processCwd/true line", () => {
		const input = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			cwd: "/repo",
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "2026-08-11T00:00:00.000Z",
		});
		assert.equal(line, "2026-08-11T00:00:00.000Z\t/repo\t/repo\ttrue");
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
			"2026-08-11T00:00:00.000Z\t/some/worktree\t/repo\tfalse",
		);
	});

	it("still produces a 4-column line for malformed JSON, with an empty payload cwd", () => {
		const line = buildDriftLogLine("not json{{{", {
			processCwd: "/repo",
			now: () => "2026-08-11T00:00:00.000Z",
		});
		assert.equal(line, "2026-08-11T00:00:00.000Z\t\t/repo\tfalse");
	});

	it("still produces a 4-column line when the payload has no cwd field", () => {
		const input = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
		});
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "2026-08-11T00:00:00.000Z",
		});
		assert.equal(line, "2026-08-11T00:00:00.000Z\t\t/repo\tfalse");
	});

	it("uses the injected `now` for the timestamp column, not the wall clock", () => {
		const input = JSON.stringify({ cwd: "/repo" });
		const line = buildDriftLogLine(input, {
			processCwd: "/repo",
			now: () => "SENTINEL-TIMESTAMP",
		});
		assert.equal(line.split("\t")[0], "SENTINEL-TIMESTAMP");
	});
});
