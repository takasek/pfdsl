import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatLinebreakAdvisory, isMarkdownWrite } from "./md-write-check.mjs";
import { formatViolation } from "../check-md-linebreaks.mjs";

describe("isMarkdownWrite", () => {
	it("flags a Write of a .md file", () => {
		const result = isMarkdownWrite({
			hook_event_name: "PostToolUse",
			tool_name: "Write",
			tool_input: { file_path: "/repo/docs/foo.md" },
		});
		assert.equal(result, true);
	});

	it("ignores Edit — this hook is only about newly written files", () => {
		const result = isMarkdownWrite({
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: { file_path: "/repo/docs/foo.md" },
		});
		assert.equal(result, false);
	});

	it("ignores a non-.md Write", () => {
		const result = isMarkdownWrite({
			hook_event_name: "PostToolUse",
			tool_name: "Write",
			tool_input: { file_path: "/repo/scripts/foo.mjs" },
		});
		assert.equal(result, false);
	});

	it("ignores a payload with no file_path", () => {
		const result = isMarkdownWrite({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: {} });
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
