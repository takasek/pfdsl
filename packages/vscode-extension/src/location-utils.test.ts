import { describe, expect, it } from "vitest";
import {
	buildDescriptions,
	buildLocations,
	buildSubflows,
	normalizeLocation,
} from "./location-utils.js";

describe("normalizeLocation", () => {
	it("wraps a non-empty string in an array", () => {
		expect(normalizeLocation("docs/spec.md")).toEqual(["docs/spec.md"]);
	});

	it("returns empty array for empty string", () => {
		expect(normalizeLocation("")).toEqual([]);
	});

	it("filters non-string items from an array", () => {
		expect(normalizeLocation(["a.ts", 42, "b.ts", ""])).toEqual([
			"a.ts",
			"b.ts",
		]);
	});

	it("returns empty array for null/undefined/number", () => {
		expect(normalizeLocation(null)).toEqual([]);
		expect(normalizeLocation(undefined)).toEqual([]);
		expect(normalizeLocation(42)).toEqual([]);
	});
});

describe("buildLocations", () => {
	it("returns empty object for null frontmatter", () => {
		expect(buildLocations(null)).toEqual({});
	});

	it("normalizes scalar string location for artifact", () => {
		const fm = { artifact: { spec: { location: "docs/spec.md" } } };
		expect(buildLocations(fm)).toEqual({ spec: ["docs/spec.md"] });
	});

	it("normalizes array location for artifact", () => {
		const fm = { artifact: { spec: { location: ["a.ts", "b.ts"] } } };
		expect(buildLocations(fm)).toEqual({ spec: ["a.ts", "b.ts"] });
	});

	it("includes artifact URL locations", () => {
		const fm = {
			artifact: { spec: { location: "https://example.com/spec" } },
		};
		expect(buildLocations(fm)).toEqual({ spec: ["https://example.com/spec"] });
	});

	it("excludes URL-only process locations", () => {
		const fm = {
			process: { P: { location: "https://example.com/doc" } },
		};
		expect(buildLocations(fm)).toEqual({});
	});

	it("includes file-path process locations", () => {
		const fm = { process: { P: { subflow: "child.pfdsl" } } };
		expect(buildLocations(fm)).toEqual({ P: ["child.pfdsl"] });
	});

	it("omits process entry when subflow is absent and location is URL", () => {
		const fm = {
			process: { P: { location: "https://x.com/" } },
		};
		expect(buildLocations(fm)).toEqual({});
	});
});

describe("buildDescriptions", () => {
	it("returns empty object for null frontmatter", () => {
		expect(buildDescriptions(null)).toEqual({});
	});

	it("includes description and criteria as separate rows", () => {
		const fm = {
			artifact: { a: { description: "詳細", criteria: "承認済み" } },
		};
		expect(buildDescriptions(fm)).toEqual({
			a: [
				["", "詳細"],
				["criteria", "承認済み"],
			],
		});
	});

	it("appends comma-joined locations for array location", () => {
		const fm = {
			artifact: { a: { location: ["x.ts", "y.ts"] } },
		};
		expect(buildDescriptions(fm)).toEqual({ a: [["location", "x.ts, y.ts"]] });
	});

	it("includes process description and other fields as rows", () => {
		const fm = {
			process: { P: { description: "proc desc", command: "make run" } },
		};
		expect(buildDescriptions(fm)).toEqual({
			P: [
				["", "proc desc"],
				["command", "make run"],
			],
		});
	});
});

describe("buildSubflows", () => {
	it("returns subflow when location absent", () => {
		const fm = { process: { P: { subflow: "child.pfdsl" } } };
		expect(buildSubflows(fm)).toEqual({ P: "child.pfdsl" });
	});

	it("omits subflow when process has a location", () => {
		const fm = {
			process: { P: { subflow: "child.pfdsl", location: "child.pfdsl" } },
		};
		expect(buildSubflows(fm)).toEqual({});
	});
});
