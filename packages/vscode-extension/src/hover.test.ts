import { describe, expect, it } from "vitest";
import { buildHoverLines } from "./hover-logic.js";

describe("buildHoverLines", () => {
	it("returns header line and separator for id and kind", () => {
		const lines = buildHoverLines("art1", "artifact", null);
		expect(lines[0]).toBe("📄 **art1**");
		expect(lines[1]).toBe("---");
	});

	it("returns header line for process kind", () => {
		const lines = buildHoverLines("P1", "process", null);
		expect(lines[0]).toBe("▶️ **P1**");
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
		// label and description appear as plain lines, not in the table
		expect(lines).toContain("**Spec Doc**");
		expect(lines).toContain("> A spec document");
		const table = lines.find((l) => l.startsWith("<table>")) ?? "";
		expect(table).toContain(">owner<");
		expect(table).toContain(">alice<");
		expect(table).toContain(">externalStakeholders<");
		expect(table).toContain(">corp-a, corp-b<");
		expect(table).toContain(">status<");
		expect(table).toContain(">done<");
		expect(table).toContain(">tags<");
		expect(table).toContain(">core, released<");
		expect(table).toContain(">parts<");
		expect(table).toContain(">a, b<");
		expect(table).toContain(">group<");
		expect(table).toContain(">g1<");
		expect(table).toContain(">criteria<");
		expect(table).toContain(">no duplicates<");
		expect(table).toContain(">location<");
		expect(table).toContain(">src/orders/<");
		expect(table).toContain(">revises<");
		expect(table).toContain(">art0<");
	});

	it("omits artifact meta fields that are absent", () => {
		const fm = { artifact: { art1: { label: "Only Label" } } };
		const lines = buildHoverLines("art1", "artifact", fm);
		// header + "---" + label (no table, no other fields)
		expect(lines).toHaveLength(3);
		expect(lines).toContain("**Only Label**");
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
		expect(lines).toContain("**Build**");
		expect(lines).toContain("> Builds the app");
		const table = lines.find((l) => l.startsWith("<table>")) ?? "";
		expect(table).toContain(">owner<");
		expect(table).toContain(">bob<");
		expect(table).toContain(">externalStakeholders<");
		expect(table).toContain(">vendor<");
		expect(table).toContain(">group<");
		expect(table).toContain(">ops<");
		expect(table).toContain(">tags<");
		expect(table).toContain(">ci<");
		expect(table).toContain(">command<");
		expect(table).toContain(">make build<");
		expect(table).toContain(">subflow<");
		expect(table).toContain(">sub.pfdsl<");
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
		const table = lines.find((l) => l.startsWith("<table>")) ?? "";
		expect(table).toContain(">location<");
		expect(table).toContain(">src/a/, src/b/<");
	});

	it("renders multiline description as blockquote lines", () => {
		const fm = {
			artifact: { art1: { description: "line one\nline two" } },
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		expect(lines).toContain("> line one");
		expect(lines).toContain("> line two");
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
		const table = lines.find((l) => l.startsWith("<table>")) ?? "";
		expect(table).toContain(">criteria<");
		expect(table).toContain("- no duplicates<br>- required fields filled");
	});

	it("expands group label when group definition exists", () => {
		const fm = {
			artifact: { art1: { group: "g1" } },
			group: { g1: { label: "Input Docs" } },
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		const table = lines.find((l) => l.startsWith("<table>")) ?? "";
		expect(table).toContain(">g1 (Input Docs)<");
	});

	it("shows group id only when no label defined", () => {
		const fm = {
			artifact: { art1: { group: "g1" } },
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		const table = lines.find((l) => l.startsWith("<table>")) ?? "";
		expect(table).toContain(">g1<");
	});
});
