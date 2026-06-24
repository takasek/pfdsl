import { describe, expect, it } from "vitest";
import { buildHoverLines } from "./hover-logic.js";

describe("buildHoverLines", () => {
	it("returns header line with id and kind", () => {
		const lines = buildHoverLines("art1", "artifact", null);
		expect(lines[0]).toBe("**art1** _(artifact)_");
	});

	it("returns header line for process kind", () => {
		const lines = buildHoverLines("P1", "process", null);
		expect(lines[0]).toBe("**P1** _(process)_");
	});

	it("includes artifact meta fields when present", () => {
		const fm = {
			artifact: {
				art1: {
					label: "Spec Doc",
					owner: "alice",
					status: "done" as const,
					tags: ["core", "released"],
					parts: ["a", "b"],
				},
			},
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		expect(lines).toContain("label: Spec Doc");
		expect(lines).toContain("owner: alice");
		expect(lines).toContain("status: done");
		expect(lines).toContain("tags: core, released");
		expect(lines).toContain("parts: a, b");
	});

	it("omits artifact meta fields that are absent", () => {
		const fm = { artifact: { art1: { label: "Only Label" } } };
		const lines = buildHoverLines("art1", "artifact", fm);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toBe("label: Only Label");
	});

	it("includes process meta label and owner", () => {
		const fm = {
			process: { P1: { label: "Build", owner: "bob" } },
		};
		const lines = buildHoverLines("P1", "process", fm);
		expect(lines).toContain("label: Build");
		expect(lines).toContain("owner: bob");
	});

	it("returns only header when id not in frontmatter", () => {
		const fm = { artifact: {} };
		const lines = buildHoverLines("missing", "artifact", fm);
		expect(lines).toHaveLength(1);
	});

	it("returns only header when frontmatter is null", () => {
		const lines = buildHoverLines("x", "artifact", null);
		expect(lines).toHaveLength(1);
	});
});
