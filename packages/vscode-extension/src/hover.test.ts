import { describe, expect, it } from "vitest";
import { buildHoverLines } from "./hover-logic.js";

describe("buildHoverLines", () => {
	it("returns header line and separator for id and kind", () => {
		const lines = buildHoverLines("art1", "artifact", null);
		expect(lines[0]).toBe("**art1** _(artifact)_");
		expect(lines[1]).toBe("---");
	});

	it("returns header line for process kind", () => {
		const lines = buildHoverLines("P1", "process", null);
		expect(lines[0]).toBe("**P1** _(process)_");
	});

	it("includes all artifact meta fields when present", () => {
		const fm = {
			artifact: {
				art1: {
					label: "Spec Doc",
					description: "A spec document",
					owner: "alice",
					externalStakeholders: ["corp-a", "corp-b"],
					status: "done" as const,
					tags: ["core", "released"],
					parts: ["a", "b"],
					group: "g1",
					criteria: "no duplicates",
					location: "src/orders/",
					revises: "art0",
				},
			},
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		expect(lines).toContain("**label:** Spec Doc");
		expect(lines).toContain("**description:** A spec document");
		expect(lines).toContain("**owner:** alice");
		expect(lines).toContain("**externalStakeholders:** corp-a, corp-b");
		expect(lines).toContain("**status:** done");
		expect(lines).toContain("**tags:** core, released");
		expect(lines).toContain("**parts:** a, b");
		expect(lines).toContain("**group:** g1");
		expect(lines).toContain("**criteria:** no duplicates");
		expect(lines).toContain("**location:** src/orders/");
		expect(lines).toContain("**revises:** art0");
	});

	it("omits artifact meta fields that are absent", () => {
		const fm = { artifact: { art1: { label: "Only Label" } } };
		const lines = buildHoverLines("art1", "artifact", fm);
		expect(lines).toHaveLength(3); // header + "---" + label
		expect(lines[2]).toBe("**label:** Only Label");
	});

	it("includes all process meta fields", () => {
		const fm = {
			process: {
				P1: {
					label: "Build",
					description: "Builds the app",
					owner: "bob",
					externalStakeholders: ["vendor"],
					group: "ops",
					tags: ["ci"],
					command: "make build",
					subflow: "sub.pfdsl",
				},
			},
		};
		const lines = buildHoverLines("P1", "process", fm);
		expect(lines).toContain("**label:** Build");
		expect(lines).toContain("**description:** Builds the app");
		expect(lines).toContain("**owner:** bob");
		expect(lines).toContain("**externalStakeholders:** vendor");
		expect(lines).toContain("**group:** ops");
		expect(lines).toContain("**tags:** ci");
		expect(lines).toContain("**command:** make build");
		expect(lines).toContain("**subflow:** sub.pfdsl");
	});

	it("returns only header and separator when id not in frontmatter", () => {
		const fm = { artifact: {} };
		const lines = buildHoverLines("missing", "artifact", fm);
		expect(lines).toHaveLength(2);
	});

	it("returns only header and separator when frontmatter is null", () => {
		const lines = buildHoverLines("x", "artifact", null);
		expect(lines).toHaveLength(2);
	});

	it("normalizes location array to comma-separated string", () => {
		const fm = {
			artifact: { art1: { location: ["src/a/", "src/b/"] } },
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		expect(lines).toContain("**location:** src/a/, src/b/");
	});
});
