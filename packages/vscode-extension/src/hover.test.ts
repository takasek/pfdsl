import { describe, expect, it } from "vitest";
import { buildHoverLines } from "./hover-logic.js";

function tableContent(lines: string[]): string {
	return lines.find((l) => l.startsWith("| | |")) ?? "";
}

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
		expect(lines).toContain("**Spec Doc**");
		expect(lines).toContain("> A spec document");
		const table = tableContent(lines);
		expect(table).toContain("_owner_");
		expect(table).toContain("alice");
		expect(table).toContain("_externalStakeholders_");
		expect(table).toContain("corp-a, corp-b");
		expect(table).toContain("_status_");
		expect(table).toContain("done");
		expect(table).toContain("_tags_");
		expect(table).toContain("core, released");
		expect(table).toContain("_parts_");
		expect(table).toContain("a, b");
		expect(table).toContain("_group_");
		expect(table).toContain("g1");
		expect(table).toContain("_criteria_");
		expect(table).toContain("no duplicates");
		expect(table).toContain("_location_");
		expect(table).toContain("src/orders/");
		expect(table).toContain("_revises_");
		expect(table).toContain("art0");
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
		const table = tableContent(lines);
		expect(table).toContain("_owner_");
		expect(table).toContain("bob");
		expect(table).toContain("_externalStakeholders_");
		expect(table).toContain("vendor");
		expect(table).toContain("_group_");
		expect(table).toContain("ops");
		expect(table).toContain("_tags_");
		expect(table).toContain("ci");
		expect(table).toContain("_command_");
		expect(table).toContain("make build");
		expect(table).toContain("_subflow_");
		expect(table).toContain("sub.pfdsl");
		expect(lines.some((l) => l.includes("▶ Run command"))).toBe(false); // no docUri
	});

	it("shows run command link in command table cell when docUri provided", () => {
		const fm = {
			process: { P1: { command: "make build" } },
		};
		const lines = buildHoverLines("P1", "process", fm, "file:///repo/a.pfdsl");
		const table = tableContent(lines);
		expect(table).toContain("_command_");
		expect(table).toContain("make build");
		expect(table).toContain("[▶ run](command:pfdsl._runProcessCommand?");
		expect(table).toContain("make%20build");
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
		const table = tableContent(lines);
		expect(table).toContain("_location_");
		expect(table).toContain("src/a/, src/b/");
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
		const table = tableContent(lines);
		expect(table).toContain("_criteria_");
		expect(table).toContain("- no duplicates<br>- required fields filled");
	});

	it("expands group label when group definition exists", () => {
		const fm = {
			artifact: { art1: { group: "g1" } },
			group: { g1: { label: "Input Docs" } },
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		const table = tableContent(lines);
		expect(table).toContain("g1 (Input Docs)");
	});

	it("shows group id only when no label defined", () => {
		const fm = {
			artifact: { art1: { group: "g1" } },
		};
		const lines = buildHoverLines("art1", "artifact", fm);
		const table = tableContent(lines);
		expect(table).toContain("g1");
	});

	it("makes artifact group clickable when docUri provided", () => {
		const fm = {
			artifact: { art1: { group: "g1" } },
			group: { g1: { label: "Input Docs" } },
		};
		const lines = buildHoverLines(
			"art1",
			"artifact",
			fm,
			"file:///repo/a.pfdsl",
		);
		const table = tableContent(lines);
		expect(table).toContain("command:pfdsl._gotoNodeDefinition");
		expect(table).toContain("g1");
		expect(table).toContain("Input Docs");
	});

	it("makes location clickable as directory command when docUri provided", () => {
		const fm = { artifact: { art1: { location: "src/orders/" } } };
		const lines = buildHoverLines(
			"art1",
			"artifact",
			fm,
			"file:///repo/a.pfdsl",
		);
		const table = tableContent(lines);
		expect(table).toContain("command:pfdsl._openDirLocation");
		expect(table).toContain("src/orders/");
	});

	it("makes location clickable as file:// link when docUri provided", () => {
		const fm = { artifact: { art1: { location: "src/orders/order.ts" } } };
		const lines = buildHoverLines(
			"art1",
			"artifact",
			fm,
			"file:///repo/a.pfdsl",
		);
		const table = tableContent(lines);
		expect(table).toContain("file:///repo/src/orders/order.ts");
		expect(table).toContain("src/orders/order.ts");
	});

	it("makes process group clickable when docUri provided", () => {
		const fm = { process: { P1: { group: "ops" } } };
		const lines = buildHoverLines("P1", "process", fm, "file:///repo/a.pfdsl");
		const table = tableContent(lines);
		expect(table).toContain("command:pfdsl._gotoNodeDefinition");
		expect(table).toContain("ops");
	});

	it("resolves location relative to basePath when basePath is set", () => {
		const fm = {
			basePath: "../",
			artifact: { art1: { location: "config.json" } },
		};
		// docUri: file:///repo/sub/a.pfdsl; basePath ../ → /repo/; config.json → /repo/config.json
		const lines = buildHoverLines(
			"art1",
			"artifact",
			fm,
			"file:///repo/sub/a.pfdsl",
		);
		const table = tableContent(lines);
		expect(table).toContain("file:///repo/config.json");
	});

	it("passes basePath as third arg in run command link when basePath is set", () => {
		const fm = {
			basePath: "../",
			process: { P1: { command: "make build" } },
		};
		const lines = buildHoverLines(
			"P1",
			"process",
			fm,
			"file:///repo/sub/a.pfdsl",
		);
		const table = tableContent(lines);
		expect(table).toContain("_command_");
		expect(table).toContain("make build");
		// The JSON args should include basePath as third element
		expect(table).toContain("..%2F"); // "../" URL-encoded
	});
});

describe("buildHoverLines (group kind)", () => {
	it("returns header with group icon and label", () => {
		const fm = { group: { g1: { label: "Inputs" } } };
		const lines = buildHoverLines("g1", "group", fm);
		expect(lines[0]).toBe("🗂 **g1**");
		expect(lines[2]).toBe("**Inputs**");
	});

	it("lists artifact and process members grouped by kind", () => {
		const fm = {
			group: { g1: { label: "Inputs" } },
			artifact: {
				art1: { group: "g1" },
				art2: { group: "other" },
			},
			process: {
				P1: { group: "g1" },
			},
		};
		const lines = buildHoverLines("g1", "group", fm);
		const table = tableContent(lines);
		expect(table).toContain("_artifact_");
		expect(table).toContain("📄 art1");
		expect(table).not.toContain("art2");
		expect(table).toContain("_process_");
		expect(table).toContain("▶️ P1");
	});

	it("makes members clickable when docUri is provided", () => {
		const fm = {
			group: { g1: { label: "Inputs" } },
			artifact: { art1: { group: "g1" } },
			process: { P1: { group: "g1" } },
		};
		const lines = buildHoverLines("g1", "group", fm, "file:///repo/a.pfdsl");
		const table = tableContent(lines);
		expect(table).toContain("command:pfdsl._gotoNodeDefinition");
		expect(table).toContain("art1");
		expect(table).toContain("P1");
	});

	it("omits member table when group has no members", () => {
		const fm = {
			group: { empty: { label: "Empty" } },
			artifact: {},
			process: {},
		};
		const lines = buildHoverLines("empty", "group", fm);
		expect(lines.some((l) => l.startsWith("| | |"))).toBe(false);
	});

	it("handles group with no label", () => {
		const fm = { group: { g2: {} } };
		const lines = buildHoverLines("g2", "group", fm);
		expect(lines[0]).toBe("🗂 **g2**");
		expect(lines).toHaveLength(2); // header + "---"
	});

	it("returns only header and separator when id not in frontmatter group", () => {
		const lines = buildHoverLines("unknown", "group", null);
		expect(lines).toHaveLength(2);
	});
});
