import { describe, expect, it } from "vitest";
import { detectChildIndent, escapeRe } from "./frontmatter-text.js";

describe("escapeRe", () => {
	it("escapes regex metacharacters", () => {
		expect(escapeRe("a.b*c")).toBe("a\\.b\\*c");
	});

	it("leaves plain identifiers untouched", () => {
		expect(escapeRe("plain_id-123")).toBe("plain_id-123");
	});

	it("escapes ids so they match literally when used in a RegExp", () => {
		const id = "req(v2)";
		const re = new RegExp(`^${escapeRe(id)}$`);
		expect(re.test("req(v2)")).toBe(true);
		expect(re.test("reqXv2X")).toBe(false);
	});
});

describe("detectChildIndent", () => {
	it("detects 2-space indent from the first non-empty, non-comment line", () => {
		expect(detectChildIndent(["  foo:", "    status: done"])).toBe(2);
	});

	it("detects 4-space indent from the first non-empty, non-comment line", () => {
		expect(detectChildIndent(["    foo:", "        status: done"])).toBe(4);
	});

	it("skips leading blank and comment lines", () => {
		expect(detectChildIndent(["", "  # a comment", "    foo:"])).toBe(4);
	});

	it("falls back to the given default when no content line is found", () => {
		expect(detectChildIndent(["", "  # only a comment"])).toBe(2);
		expect(detectChildIndent([], 4)).toBe(4);
	});
});
