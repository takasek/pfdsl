import { describe, expect, it } from "vitest";
import { indentOf } from "./frontmatter-text.js";

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
