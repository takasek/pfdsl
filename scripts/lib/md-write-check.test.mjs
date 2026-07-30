import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatLinebreakAdvisory, isMarkdownChange } from "./md-write-check.mjs";
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
