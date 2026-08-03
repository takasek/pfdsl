import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	formatLinebreakAdvisory,
	isMarkdownChange,
	runMdWriteCheck,
} from "./md-write-check.mjs";
import { formatViolation } from "../check-md-linebreaks.mjs";

describe("isMarkdownChange", () => {
	it("flags a Write of a .md file", () => {
		const result = isMarkdownChange({
			hook_event_name: "PostToolUse",
			tool_name: "Write",
			tool_input: { file_path: "/repo/docs/foo.md" },
		});
		assert.equal(result, true);
	});

	it("flags an Edit of a .md file — most prose arrives that way", () => {
		const result = isMarkdownChange({
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: { file_path: "/repo/docs/foo.md" },
		});
		assert.equal(result, true);
	});

	it("ignores a non-.md change", () => {
		const result = isMarkdownChange({
			hook_event_name: "PostToolUse",
			tool_name: "Write",
			tool_input: { file_path: "/repo/scripts/foo.mjs" },
		});
		assert.equal(result, false);
	});

	it("ignores tools that write no file", () => {
		const result = isMarkdownChange({
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: "touch docs/foo.md" },
		});
		assert.equal(result, false);
	});

	it("ignores a payload with no file_path", () => {
		const result = isMarkdownChange({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: {} });
		assert.equal(result, false);
	});
});

describe("formatLinebreakAdvisory", () => {
	it("is undefined when there are no violations, so the hook prints nothing", () => {
		assert.equal(formatLinebreakAdvisory("/repo/docs/foo.md", [], formatViolation), undefined);
	});

	it("names the file and includes each violation when there are some", () => {
		const violations = [
			{ file: "/repo/docs/foo.md", line: 12, prev: "- item", cont: "continuation" },
		];
		const result = formatLinebreakAdvisory("/repo/docs/foo.md", violations, formatViolation);
		assert.match(result, /\/repo\/docs\/foo\.md/);
		assert.match(result, /mid-sentence line break/);
		assert.match(result, /continuation/);
	});
});

describe("runMdWriteCheck", () => {
	const violation = { file: "/repo/docs/foo.md", line: 12, prev: "- item", cont: "continuation" };
	const input = JSON.stringify({
		hook_event_name: "PostToolUse",
		tool_name: "Edit",
		tool_input: { file_path: "/repo/docs/foo.md" },
	});

	it("prints the advisory for a file with violations", () => {
		const { shouldOutput, output } = runMdWriteCheck(input, {
			checkFile: () => [violation],
			formatViolation,
		});
		assert.equal(shouldOutput, true);
		assert.match(output.hookSpecificOutput.additionalContext, /mid-sentence line break/);
	});

	it("produces no output for a clean file", () => {
		assert.deepEqual(runMdWriteCheck(input, { checkFile: () => [], formatViolation }), {
			shouldOutput: false,
		});
	});

	it("stays silent when the file cannot be read — it may already be gone", () => {
		const result = runMdWriteCheck(input, {
			checkFile: () => {
				throw new Error("ENOENT");
			},
			formatViolation,
		});
		assert.deepEqual(result, { shouldOutput: false });
	});

	it("never reads a file for a payload that is not a .md change", () => {
		let called = false;
		const other = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: { file_path: "/repo/scripts/foo.mjs" },
		});
		runMdWriteCheck(other, {
			checkFile: () => {
				called = true;
				return [];
			},
			formatViolation,
		});
		assert.equal(called, false);
	});

	it("silently allows malformed stdin JSON", () => {
		assert.deepEqual(runMdWriteCheck("not json{{{", { checkFile: () => [], formatViolation }), {
			shouldOutput: false,
		});
	});
});
