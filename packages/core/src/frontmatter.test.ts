import { describe, expect, it } from "vitest";
import { findFrontmatterNodeRanges, loadFrontmatter } from "./frontmatter.js";

describe("loadFrontmatter", () => {
	it("no frontmatter: returns body as-is, bodyStartLine=1", () => {
		const result = loadFrontmatter("A >> P -> B\n");
		expect(result.frontmatter).toBeNull();
		expect(result.body).toBe("A >> P -> B\n");
		expect(result.bodyStartLine).toBe(1);
		expect(result.diagnostics).toHaveLength(0);
	});

	// A CRLF file's last frontmatter line used to keep its \r, because the
	// slice dropped exactly one character before the closing fence (#636). The
	// value silently gained a \r, so a last-line `status: done` failed V007.
	describe("CRLF and padded fences", () => {
		const crlf = (...lines: string[]) => lines.join("\r\n");

		it("does not leave a \\r on the value of the last frontmatter line", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    criteria: approved",
				"---",
				"req >> design -> spec",
				"",
			);
			const result = loadFrontmatter(src);
			expect(result.frontmatter).toEqual({
				artifact: { spec: { criteria: "approved" } },
			});
		});

		it("keeps a last-line status usable, so a CRLF file is not rejected", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    status: done",
				"---",
				"req >> design -> spec",
				"",
			);
			const fm = loadFrontmatter(src).frontmatter as {
				artifact: { spec: { status: string } };
			};
			expect(fm.artifact.spec.status).toBe("done");
		});

		it("reads a CRLF file with several frontmatter lines the same as LF", () => {
			const lines = [
				"---",
				"title: Test",
				"artifact:",
				"  spec:",
				"    label: Spec",
				"---",
				"req >> design -> spec",
				"",
			];
			expect(loadFrontmatter(lines.join("\r\n")).frontmatter).toEqual(
				loadFrontmatter(lines.join("\n")).frontmatter,
			);
		});

		it("accepts a closing fence with trailing spaces", () => {
			const src =
				"---\nartifact:\n  spec:\n    label: Spec\n---   \nreq >> design -> spec\n";
			const result = loadFrontmatter(src);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.frontmatter).toEqual({
				artifact: { spec: { label: "Spec" } },
			});
		});

		it("accepts a CRLF closing fence, which carries a \\r of its own", () => {
			const src = crlf(
				"---",
				"title: Test",
				"---",
				"req >> design -> spec",
				"",
			);
			expect(loadFrontmatter(src).diagnostics).toHaveLength(0);

			// The trailing-space and CRLF cases above show the fence match tolerates a
			// padded line end; these two show it does not tolerate everything — removing
			// the trim, or loosening the match, has to fail one side or the other (#637).
			describe("closing fence refusals", () => {
				it("still reports FM001 when the fence is genuinely absent", () => {
					const result = loadFrontmatter("---\ntitle: Test\nA >> P\n");
					expect(result.diagnostics.map((d) => d.code)).toEqual(["FM001"]);
				});

				it("does not take an indented --- as the closing fence", () => {
					const result = loadFrontmatter("---\ntitle: Test\n  ---\nA >> P\n");
					expect(result.diagnostics.map((d) => d.code)).toEqual(["FM001"]);
				});
			});
		});
	});

	it("valid frontmatter: parses YAML and extracts body", () => {
		const src = "---\ntitle: Test\n---\nA >> P\n";
		const result = loadFrontmatter(src);
		expect(result.frontmatter).toEqual({ title: "Test" });
		expect(result.body).toBe("A >> P\n");
		expect(result.bodyStartLine).toBe(4);
		expect(result.diagnostics).toHaveLength(0);
	});

	it("empty frontmatter block: returns null frontmatter", () => {
		const src = "---\n---\nA >> P\n";
		const result = loadFrontmatter(src);
		expect(result.frontmatter).toBeNull();
		expect(result.body).toBe("A >> P\n");
		expect(result.bodyStartLine).toBe(3);
	});

	it("invalid YAML: returns error diagnostic and null frontmatter", () => {
		const src = "---\n: bad: yaml\n---\nbody\n";
		const result = loadFrontmatter(src);
		expect(result.frontmatter).toBeNull();
		expect(
			result.diagnostics.some(
				(d) => d.severity === "error" && d.code === "FM002",
			),
		).toBe(true);
	});

	it("unclosed frontmatter: returns error and treats whole source as body", () => {
		const src = "---\ntitle: Test\n";
		const result = loadFrontmatter(src);
		expect(result.frontmatter).toBeNull();
		expect(result.diagnostics.some((d) => d.code === "FM001")).toBe(true);
	});

	it("bodyStartLine accounts for frontmatter line count", () => {
		const src = "---\na: 1\nb: 2\n---\nbody";
		const result = loadFrontmatter(src);
		expect(result.bodyStartLine).toBe(5);
	});

	it("parses status, tags, statusStyles, tag", () => {
		const src = [
			"---",
			"artifact:",
			"  spec:",
			"    status: done",
			"    tags: [external, critical]",
			"statusStyles:",
			"  done: { fillcolor: lightgray, style: filled }",
			"tag:",
			"  external: { label: 外部公開, style: { color: blue } }",
			'  critical: { style: { penwidth: "3" } }',
			"---",
			"spec >> P -> X",
			"",
		].join("\n");
		const result = loadFrontmatter(src);
		expect(result.diagnostics).toHaveLength(0);
		const fm = result.frontmatter!;
		expect(fm.artifact?.spec?.status).toBe("done");
		expect(fm.artifact?.spec?.tags).toEqual(["external", "critical"]);
		expect(fm.statusStyles?.done?.fillcolor).toBe("lightgray");
		expect(fm.tag?.external?.label).toBe("外部公開");
		expect(fm.tag?.external?.style?.color).toBe("blue");
		expect(fm.tag?.critical?.style?.penwidth).toBe("3");
	});
});

describe("findFrontmatterNodeRanges", () => {
	it("locates node id ranges at 2-space indent (canonical style)", () => {
		const src = [
			"---",
			"artifact:",
			"  spec:",
			"    status: done",
			"---",
			"spec >> P -> X",
			"",
		].join("\n");
		const ranges = findFrontmatterNodeRanges(src);
		expect(ranges.get("spec")).toEqual({
			start: { line: 3, column: 3, offset: src.indexOf("spec:") },
			end: { line: 3, column: 7, offset: src.indexOf("spec:") + 4 },
		});
	});

	it("locates node id ranges at 4-space indent (#430)", () => {
		const src = [
			"---",
			"artifact:",
			"    spec:",
			"        status: done",
			"---",
			"spec >> P -> X",
			"",
		].join("\n");
		const ranges = findFrontmatterNodeRanges(src);
		expect(ranges.get("spec")).toEqual({
			start: { line: 3, column: 5, offset: src.indexOf("spec:") },
			end: { line: 3, column: 9, offset: src.indexOf("spec:") + 4 },
		});
	});

	it("detects indent independently per section (#430)", () => {
		const src = [
			"---",
			"artifact:",
			"    spec:",
			"        status: done",
			"process:",
			"  build:",
			"    status: wip",
			"---",
			"spec >> build -> out",
			"",
		].join("\n");
		const ranges = findFrontmatterNodeRanges(src);
		expect(ranges.get("spec")).toEqual({
			start: { line: 3, column: 5, offset: src.indexOf("spec:") },
			end: { line: 3, column: 9, offset: src.indexOf("spec:") + 4 },
		});
		expect(ranges.get("build")).toEqual({
			start: { line: 6, column: 3, offset: src.indexOf("build:") },
			end: { line: 6, column: 8, offset: src.indexOf("build:") + 5 },
		});
	});
});

describe("string-sequence element types (FM004)", () => {
	const fields = [
		"tags",
		"extends",
		"artifact.a.tags",
		"artifact.a.parts",
		"artifact.a.externalStakeholders",
		"artifact.a.location",
		"process.p.tags",
		"process.p.externalStakeholders",
		"process.p.location",
	];
	function sourceFor(path: string, value: string) {
		const keys = path.split(".");
		return `---\n${keys.map((key, i) => `${"  ".repeat(i)}${key}:${i === keys.length - 1 ? ` ${value}` : ""}`).join("\n")}\n---\na >> p -> b\n`;
	}
	for (const field of fields) {
		for (const value of [
			"[{x: y}]",
			"[[nested]]",
			"[42]",
			"[true]",
			"[null]",
		]) {
			it(`rejects ${value} in ${field}`, () => {
				const result = loadFrontmatter(sourceFor(field, value));
				expect(result.diagnostics).toEqual([
					expect.objectContaining({
						code: "FM004",
						severity: "error",
						message: expect.stringContaining(field),
					}),
				]);
				expect(result.frontmatter).toBeNull();
			});
		}
		for (const value of ["[]", '["x: y", "42", "true", "null", ""]']) {
			it(`accepts ${value} in ${field}`, () => {
				expect(loadFrontmatter(sourceFor(field, value)).diagnostics).toEqual(
					[],
				);
			});
		}
	}
	it.each([
		"\n",
		"\r\n",
	])("locates each offending element with %j newlines", (newline) => {
		const source = [
			"---",
			"artifact:",
			"  a:",
			"    tags:",
			"      - x: y",
			"      - 42",
			"---",
			"a >> p -> b",
		].join(newline);
		const result = loadFrontmatter(source);
		expect(
			result.diagnostics.map((d) => [
				d.code,
				d.range.start.line,
				d.range.start.column,
				source.slice(d.range.start.offset, d.range.end.offset).trim(),
			]),
		).toEqual([
			["FM004", 5, 9, "x: y"],
			["FM004", 6, 9, "42"],
		]);
	});
	it("accepts string aliases, block scalars, scalar paths, and unrelated extension values", () => {
		const source = `---
text: &text hello
list: &list [*text]
tags: *list
extends: ./theme.yaml
artifact:
  a:
    tags:
      - *text
      - |
        x: y
    location: ./a.md
    custom:
      tags: [{x: y}]
    owner: alice
process:
  p:
    parts: [{custom: value}]
tag:
  x:
    tags: [{custom: value}]
---
a >> p -> b
`;
		expect(loadFrontmatter(source).diagnostics).toEqual([]);
	});
	it.each([
		["bad: &bad {x: y}\ntags: [*bad]", "*bad"],
		["bad: &bad [{x: y}]\ntags: *bad", "*bad"],
		["bad: &bad {tags: [{x: y}]}\nartifact:\n  a: *bad", "*bad"],
		["bad: &bad {a: {tags: [{x: y}]}}\nartifact: *bad", "*bad"],
	])("checks aliases at every supported path level: %s", (yaml, marker) => {
		const source = `---\n${yaml}\n---\na >> p -> b\n`;
		const diagnostics = loadFrontmatter(source).diagnostics;
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("FM004");
		expect(diagnostics[0]?.range.start.offset).toBe(source.lastIndexOf(marker));
	});
	it("leaves invalid YAML and unresolved aliases to FM002", () => {
		for (const yaml of [
			"tags: [*missing]",
			"tags: [",
			"tags: [a]\ntags: [b]",
		]) {
			const diagnostics = loadFrontmatter(
				`---\n${yaml}\n---\na >> p\n`,
			).diagnostics;
			expect(diagnostics.map((d) => d.code)).toEqual(["FM002"]);
		}
	});
	it("diagnoses cyclic and empty sequence elements without throwing", () => {
		for (const yaml of ["tags: &tags [*tags]", "tags:\n  -"]) {
			const result = loadFrontmatter(`---\n${yaml}\n---\na >> p\n`);
			expect(result.diagnostics.some((d) => d.code === "FM004")).toBe(true);
		}
	});
});

describe("FM004 with YAML metadata keys", () => {
	it.each([
		'"42"',
		'"true"',
		'"01"',
		'"null"',
		"!!str 42",
	])("locates field errors under string key %s", (id) => {
		const source = `---\nartifact:\n  ${id}:\n    tags: [{x: y}]\n---\na >> p -> b\n`;
		const result = loadFrontmatter(source);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]?.code).toBe("FM004");
		expect(result.diagnostics[0]?.range.start.line).toBe(4);
		expect(
			source.slice(
				result.diagnostics[0]?.range.start.offset,
				result.diagnostics[0]?.range.end.offset,
			),
		).toBe("{x: y}");
	});
});

describe("known frontmatter field shapes", () => {
	const strings = [
		"title",
		"dslVersion",
		"description",
		"basePath",
		"artifact.a.label",
		"artifact.a.description",
		"artifact.a.owner",
		"artifact.a.group",
		"artifact.a.criteria",
		"artifact.a.revises",
		"process.p.label",
		"process.p.description",
		"process.p.owner",
		"process.p.group",
		"process.p.command",
		"process.p.subflow",
		"process.p.boundary.a",
		"group.g.label",
		"group.g.color",
		"group.g.parent",
		"tag.t.label",
		"tag.t.description",
		"tag.t.style.fillcolor",
		"statusStyles.done.penwidth",
	];
	const arrays = [
		"tags",
		"artifact.a.tags",
		"artifact.a.parts",
		"artifact.a.externalStakeholders",
		"process.p.tags",
		"process.p.externalStakeholders",
	];
	const numbers = ["artifact.a.index", "process.p.index", "layout.maxWidth"];
	const maps = [
		"artifact",
		"process",
		"group",
		"tag",
		"layout",
		"statusStyles",
		"artifact.a",
		"process.p",
		"group.g",
		"tag.t",
		"tag.t.style",
		"statusStyles.done",
		"process.p.boundary",
	];
	function source(path: string, value: string) {
		const keys = path.split(".");
		return `---\n${keys.map((key, i) => `${"  ".repeat(i)}${key}:${i === keys.length - 1 ? ` ${value}` : ""}`).join("\n")}\n---\na >> p -> b\n`;
	}
	for (const [fields, value] of [
		[strings, "42"],
		[arrays, "hello"],
		[numbers, "wide"],
		[maps, "[]"],
	] as const) {
		it.each(fields)(`rejects ${value} at %s`, (path) => {
			const result = loadFrontmatter(source(path, value));
			expect(result.frontmatter).toBeNull();
			expect(result.diagnostics).toEqual([
				expect.objectContaining({
					code: "FM004",
					message: expect.stringContaining(path),
				}),
			]);
		});
	}
	it.each([
		"42",
		"true",
		"[one, two]",
		"null",
		"~",
	])("rejects non-map root %s", (value) => {
		expect(loadFrontmatter(`---\n${value}\n---\na >> p\n`).diagnostics).toEqual(
			[expect.objectContaining({ code: "FM004" })],
		);
	});
	it.each([
		"location",
		"extends",
	])("locates invalid union array elements in %s", (field) => {
		const yaml =
			field === "location"
				? "artifact:\n  a:\n    location: [ok, 42]"
				: "extends: [ok, 42]";
		const src = `---\n${yaml}\n---\na >> p\n`;
		const diagnostics = loadFrontmatter(src).diagnostics;
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.range.start.offset).toBe(src.indexOf("42"));
	});
	// A declaration may be empty (normalized to {}), but boundary: must be a map.
	it.each([
		["block-style with no value", "    boundary:\n"],
		["an explicit null (~)", "    boundary: ~\n"],
	])("rejects an empty boundary: (%s)", (_name, boundaryLine) => {
		const result = loadFrontmatter(
			`---\nprocess:\n  sub:\n    subflow: ./child.pfdsl\n${boundaryLine}---\nx >> sub -> y\n`,
		);
		expect(result.frontmatter).toBeNull();
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "FM004",
				message: expect.stringContaining("boundary"),
			}),
		]);
	});
	it("accepts and normalizes empty declarations while retaining extensions", () => {
		const result = loadFrontmatter(
			"---\nartifact: {a: null}\nprocess: {p: null}\ngroup: {g: null}\ntag: {t: null}\ncustom: {values: [1, true]}\n---\na >> p\n",
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.frontmatter).toMatchObject({
			artifact: { a: {} },
			process: { p: {} },
			group: { g: {} },
			tag: { t: {} },
			custom: { values: [1, true] },
		});
	});
});

it.each([
	"artifact.a.status",
	"type",
	"layout.direction",
	"extends",
	"artifact.a.location",
	"version",
])("rejects an invalid type at %s", (path) => {
	const keys = path.split(".");
	const yaml = keys
		.map(
			(key, i) =>
				`${"  ".repeat(i)}${key}:${i === keys.length - 1 ? " true" : ""}`,
		)
		.join("\n");
	expect(
		loadFrontmatter(`---\n${yaml}\n---\na >> p\n`).diagnostics,
	).toContainEqual(expect.objectContaining({ code: "FM004" }));
});

it("does not normalize nulls in extension values sharing a section alias", () => {
	const result = loadFrontmatter(
		"---\ncustom: &x {a: null}\nartifact: *x\n---\na >> p\n",
	);
	expect(result.diagnostics).toEqual([]);
	expect(result.frontmatter?.artifact).toEqual({ a: {} });
	expect(result.frontmatter?.custom).toEqual({ a: null });
});
