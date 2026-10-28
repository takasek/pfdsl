import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { analyze, diffGraphs, format } from "./index.js";
import { FRONTMATTER_JSON_SCHEMA } from "./json-schema.js";

const target = { source: "https://example.com/project.git", revision: "main" };
const source = (frontmatter: unknown) => `---\n${stringify(frontmatter)}---\n`;
const declarations = [
	(value: unknown) => ({ baseRef: value }),
	(value: unknown) => ({ artifact: { a: { ref: value } } }),
] as const;

describe.each([false, true])("reference declarations (strict=%s)", (strict) => {
	it.each([
		null,
		"main",
		[],
		{},
		{ source: "repo" },
		{ revision: "main" },
		{ source: 42, revision: "main" },
		{ source: "repo", revision: false },
		{ source: ["repo"], revision: "main" },
	])("rejects invalid reference shapes with FM004: %j", (value) => {
		for (const declaration of declarations) {
			const result = analyze(source(declaration(value)), { strict });
			expect(result.frontmatter).toBeNull();
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: "FM004", severity: "error" }),
			);
		}
	});

	it.each([
		{ source: "", revision: "main" },
		{ source: " \t\n", revision: "main" },
		{ source: "repo", revision: "" },
		{ source: "repo", revision: " \t\n" },
		{ ...target, extra: true },
	])("rejects invalid reference contents with V037: %j", (value) => {
		for (const declaration of declarations) {
			const result = analyze(source(declaration(value)), { strict });
			expect(result.frontmatter).not.toBeNull();
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: "V037", severity: "error" }),
			);
			expect(result.diagnostics.some((d) => d.code === "FM004")).toBe(false);
		}
	});

	it("rejects process ref with V038", () => {
		const result = analyze(source({ process: { p: { ref: target } } }), {
			strict,
		});
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "V038", severity: "error" }),
		);
	});

	it.each([
		"/tmp/plan.md",
		"C:\\repo\\plan.md",
		"\\\\server\\share\\plan.md",
	])("rejects absolute artifact locations with an explicit target: %s", (location) => {
		for (const fm of [
			{ baseRef: target, artifact: { a: { location } } },
			{
				artifact: { a: { ref: target, location: ["docs/plan.md", location] } },
			},
		]) {
			expect(analyze(source(fm), { strict }).diagnostics).toContainEqual(
				expect.objectContaining({ code: "V039", severity: "error" }),
			);
		}
	});

	it("keeps URLs, relative paths, and process locations independent", () => {
		const fm = {
			baseRef: target,
			artifact: {
				a: {
					location: [
						"docs/plan.md",
						"file:///tmp/plan.md",
						"https://example.com/plan",
					],
				},
			},
			process: { p: { location: "/tmp/process.mjs", command: "build" } },
		};
		expect(
			analyze(source(fm), { strict }).diagnostics.filter((d) =>
				["V037", "V038", "V039"].includes(d.code),
			),
		).toEqual([]);
		expect(
			analyze(source({ artifact: { a: { location: "/tmp/plan.md" } } }), {
				strict,
			}).diagnostics,
		).toEqual([]);
	});

	it("never fills a partial artifact ref from baseRef", () => {
		const result = analyze(
			source({
				baseRef: target,
				artifact: { a: { ref: { revision: "develop" } } },
			}),
			{ strict },
		);
		expect(result.frontmatter).toBeNull();
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "FM004", severity: "error" }),
		);
	});
});

describe("reference metadata consumers", () => {
	it("preserves complete mappings, whitespace, and unrelated extension metadata through fmt", () => {
		const fm = {
			baseRef: target,
			artifact: {
				a: {
					ref: { source: "another-repo", revision: " develop " },
					custom: { source: 42 },
				},
			},
			custom: { ref: [true, "extension"] },
		};
		const before = source(fm);
		expect(analyze(before).frontmatter).toEqual(fm);
		expect(analyze(format(before).output).frontmatter).toEqual(fm);
	});

	it("includes ref changes in artifact diffs and ignores mapping order", () => {
		const before = analyze(source({ artifact: { a: { ref: target } } }));
		const reordered = analyze(
			source({
				artifact: {
					a: { ref: { revision: target.revision, source: target.source } },
				},
			}),
		);
		const after = analyze(
			source({ artifact: { a: { ref: { ...target, revision: "develop" } } } }),
		);
		expect(
			diffGraphs(
				before.graph,
				reordered.graph,
				before.frontmatter,
				reordered.frontmatter,
			).changedNodes,
		).toEqual([]);
		expect(
			diffGraphs(
				before.graph,
				after.graph,
				before.frontmatter,
				after.frontmatter,
			).changedNodes,
		).toEqual(["a"]);
	});

	it("exposes complete strict reference mappings in the authored JSON Schema", () => {
		const validate = new Ajv2020({ strict: false }).compile(
			FRONTMATTER_JSON_SCHEMA,
		);
		for (const declaration of declarations) {
			expect(validate(declaration(target))).toBe(true);
			for (const value of [
				"main",
				{},
				{ source: "repo" },
				{ source: "repo", revision: " " },
				{ ...target, extra: true },
			]) {
				expect(validate(declaration(value)), JSON.stringify(value)).toBe(false);
			}
		}
	});
});
