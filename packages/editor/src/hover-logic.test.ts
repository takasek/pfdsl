import { describe, expect, it } from "vitest";
import { buildHoverLines } from "./hover-logic.js";

describe("host-neutral hover metadata", () => {
	it("renders artifact fields without filesystem or command links", () => {
		const text = buildHoverLines("a", "artifact", {
			artifact: {
				a: {
					label: "A",
					description: "first\nsecond",
					owner: "Team",
					status: "wip",
					criteria: "Done",
					tags: ["tag"],
					parts: ["b"],
					externalStakeholders: ["Reader"],
					group: "g",
					location: ["a.txt", "https://example.org"],
					revises: "old",
				},
			},
			group: { g: { label: "Group" } },
		}).join("\n");
		for (const field of [
			"A",
			"first",
			"second",
			"Team",
			"wip",
			"Done",
			"tag",
			"b",
			"Reader",
			"g (Group)",
			"a.txt",
			"https://example.org",
			"old",
		])
			expect(text).toContain(field);
		expect(text).not.toContain("command:");
	});
	it("delegates optional links to the host", () => {
		const links = {
			node: (id: string) => `node:${id}`,
			location: (value: string) => `location:${value}`,
			command: (value: string) => `command:${value}`,
		};
		const fm = {
			artifact: { a: { group: "g", location: "a.txt" } },
			process: {
				p: {
					label: "P",
					description: "Process",
					owner: "Owner",
					externalStakeholders: ["Reader"],
					tags: ["t"],
					group: "missing",
					command: "echo yes",
					subflow: "child.pfdsl",
				},
			},
			group: { g: { label: "Group" }, missing: {} },
		};
		expect(buildHoverLines("a", "artifact", fm, links).join("\n")).toContain(
			"node:g (Group)",
		);
		expect(buildHoverLines("a", "artifact", fm, links).join("\n")).toContain(
			"location:a.txt",
		);
		const process = buildHoverLines("p", "process", fm, links).join("\n");
		for (const value of [
			"P",
			"Process",
			"Owner",
			"Reader",
			"t",
			"node:missing",
			"command:echo yes",
			"child.pfdsl",
		])
			expect(process).toContain(value);
		expect(buildHoverLines("p", "process", fm).join("\n")).toContain("missing");
		expect(buildHoverLines("g", "group", fm, links).join("\n")).toContain(
			"node:a",
		);
		expect(buildHoverLines("missing", "group", fm).join("\n")).toContain("▶️ p");
	});
	it("handles absent metadata, empty groups and HTML/table characters", () => {
		for (const kind of ["artifact", "process", "group"] as const) {
			expect(buildHoverLines("unknown", kind, null)).toHaveLength(2);
			expect(buildHoverLines("unknown", kind, {})).toHaveLength(2);
		}
		expect(buildHoverLines("g", "group", { group: { g: {} } })).toHaveLength(2);
		expect(
			buildHoverLines("a", "artifact", {
				artifact: { a: { owner: "<x>&|\ny", group: "g" } },
			}).join("\n"),
		).toContain("&lt;x&gt;&amp;\\|<br>y");
		expect(
			buildHoverLines("a", "artifact", { artifact: { a: {} } }),
		).toHaveLength(2);
		expect(
			buildHoverLines("p", "process", { process: { p: {} } }),
		).toHaveLength(2);
	});
});
