import { describe, expect, it } from "vitest";
import { compareIds } from "./compare.js";

describe("compareIds", () => {
	it("orders ascending, like the localeCompare it replaces", () => {
		expect(compareIds("a", "b")).toBeLessThan(0);
		expect(compareIds("b", "a")).toBeGreaterThan(0);
		expect(compareIds("a", "a")).toBe(0);
	});

	// The reason this function exists: under a Turkish collation the host
	// locale flips this pair, and the sorted output is committed (#640).
	it("keeps 'i' before 'I' regardless of the host locale", () => {
		expect(compareIds("i", "I")).toBeLessThan(0);
	});

	it("agrees with an explicitly en-US comparison on a mixed-case set", () => {
		const ids = ["Impl", "impl", "Spec", "spec", "code", "Code"];
		expect([...ids].sort(compareIds)).toEqual(
			[...ids].sort((a, b) => a.localeCompare(b, "en-US")),
		);
	});

	it("orders case-insensitively first, as collation does rather than code points", () => {
		// A code-point sort would put every uppercase letter before "a".
		expect([...["b", "A", "a", "B"]].sort(compareIds)).toEqual([
			"a",
			"A",
			"b",
			"B",
		]);
	});

	it("orders non-ASCII ids without throwing", () => {
		const ids = ["要求", "設計", "spec"];
		expect([...ids].sort(compareIds)).toHaveLength(3);
	});
});
