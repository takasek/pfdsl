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
		expect(lines).toContain("| <em>label</em> | Spec Doc |");
		expect(lines).toContain("| <em>description</em> | A spec document |");
		expect(lines).toContain("| <em>owner</em> | alice |");
		expect(lines).toContain(
			"| <em>externalStakeholders</em> | corp-a, corp-b |",
		);
		expect(lines).toContain("| <em>status</em> | done |");
		expect(lines).toContain("| <em>tags</em> | core, released |");
		expect(lines).toContain("| <em>parts</em> | a, b |");
		expect(lines).toContain("| <em>group</em> | g1 |");
		expect(lines).toContain("| <em>criteria</em> | no duplicates |");
		expect(lines).toContain("| <em>location</em> | src/orders/ |");
		expect(lines).toContain("| <em>revises</em> | art0 |");
	});

	it("omits artifact meta fields that are absent", () => {
		const fm = { artifact: { art1: { label: "Only Label" } } };
		const lines = buildHoverLines("art1", "artifact", fm);
		// header + "---" + table-header + alignment-row + data-row
		expect(lines).toHaveLength(5);
		expect(lines).toContain("| <em>label</em> | Only Label |");
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
		expect(lines).toContain("| <em>label</em> | Build |");
		expect(lines).toContain("| <em>description</em> | Builds the app |");
		expect(lines).toContain("| <em>owner</em> | bob |");
		expect(lines).toContain("| <em>externalStakeholders</em> | vendor |");
		expect(lines).toContain("| <em>group</em> | ops |");
		expect(lines).toContain("| <em>tags</em> | ci |");
		expect(lines).toContain("| <em>command</em> | make build |");
		expect(lines).toContain("| <em>subflow</em> | sub.pfdsl |");
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
		expect(lines).toContain("| <em>location</em> | src/a/, src/b/ |");
	});

	it("formats multiline criteria with br tags", () => {
		const fm = {
			artifact: {
				art1: {
					criteria: "- no duplicates\n- required fields filled",
				},
			},
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		const criteriaLine = lines.find((l) =>
			l.startsWith("| <em>criteria</em> |"),
		);
		expect(criteriaLine).toBeDefined();
		expect(criteriaLine).toContain(
			"- no duplicates<br>- required fields filled",
		);
	});

	it("expands group label when group definition exists", () => {
		const fm = {
			artifact: { art1: { group: "g1" } },
			group: { g1: { label: "Input Docs" } },
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		expect(lines).toContain("| <em>group</em> | g1 (Input Docs) |");
	});

	it("shows group id only when no label defined", () => {
		const fm = {
			artifact: { art1: { group: "g1" } },
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		expect(lines).toContain("| <em>group</em> | g1 |");
	});
});
