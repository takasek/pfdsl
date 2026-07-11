import { describe, expect, it } from "vitest";
import { detectChildIndent, escapeRe, indentOf } from "./frontmatter-text.js";

describe("indentOf", () => {
	it("returns 0 for a line with no leading whitespace", () => {
		expect(indentOf("foo:")).toBe(0);
	});

	it("counts leading spaces", () => {
		expect(indentOf("  foo:")).toBe(2);
		expect(indentOf("    foo:")).toBe(4);
	});

	it("counts leading tabs as single characters", () => {
		expect(indentOf("\tfoo:")).toBe(1);
	});

	it("returns 0 for an empty line", () => {
		expect(indentOf("")).toBe(0);
	});

	it("returns full length for a line that is only whitespace", () => {
		expect(indentOf("   ")).toBe(3);
	});
});

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
