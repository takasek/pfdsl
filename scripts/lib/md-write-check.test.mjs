import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatLinebreakAdvisory, isMarkdownWrite } from "./md-write-check.mjs";

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
	it("is undefined when the check passed, so the hook prints nothing", () => {
		const result = formatLinebreakAdvisory("/repo/docs/foo.md", { ok: true, out: "check-md-linebreaks: OK\n" });
		assert.equal(result, undefined);
	});

	it("names the file and includes the checker's output when it failed", () => {
		const result = formatLinebreakAdvisory("/repo/docs/foo.md", {
			ok: false,
			out: "docs/foo.md:12: mid-sentence line break\n1 violation(s) found.",
		});
		assert.match(result, /\/repo\/docs\/foo\.md/);
		assert.match(result, /mid-sentence line break/);
	});
});
