import { analyzeSource, format } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	analyzeDependencySnapshot,
	analyzeSnapshot,
	findNodeOccurrenceRanges,
	nodeIdAtSourcePosition,
	positionOfNodeId,
} from "./index.js";

const ids = [
	["ascii", "ascii"],
	["日本語", "日本語"],
	["成果😀", '"成果😀"'],
	["𐐀node", "𐐀node"],
] as const;

describe.each(["\n", "\r\n"])("editor source coordinates with %j", (eol) => {
	describe.each([false, true])("frontmatter %s", (withFrontmatter) => {
		it.each(
			ids,
		)("selects and resolves all authored occurrences of %s", (id, token) => {
			const prefix = withFrontmatter
				? [
						"---",
						'title: "先行😀"',
						`artifact: {${token}: {}}`,
						"---",
						"",
					].join(eol)
				: "";
			const body = `"先行😀😀" >> p -> ${token}${eol}${token} >> next -> finish${eol}`;
			const source = prefix + body;
			const model = analyzeSnapshot(source);
			const ranges = findNodeOccurrenceRanges(model, source, id);
			expect(ranges).toHaveLength(withFrontmatter ? 3 : 2);
			for (const range of ranges) {
				expect(source.slice(range.start.offset, range.end.offset)).toBe(token);
				const line = source.split("\n")[range.start.line - 1]!;
				expect(line.slice(range.start.column - 1, range.end.column - 1)).toBe(
					token,
				);
				expect(
					nodeIdAtSourcePosition(model, source, {
						line: range.start.line - 1,
						character: range.end.column - 1,
					}),
				).toBe(id);
			}
			const bodyLine = withFrontmatter ? 4 : 0;
			expect(positionOfNodeId(model.document.statements, id)).toEqual({
				line: bodyLine,
				column: source.split("\n")[bodyLine]!.indexOf(token),
			});
			// Core's formatter and body-relative AST stay on their existing contract.
			const raw = analyzeSource(source);
			expect(raw.document.statements[0]!.start.offset).toBe(0);
			expect(
				format(source).diagnostics.filter((d) => d.severity === "error"),
			).toEqual([]);
		});

		it.each([
			['"先行😀😀" >> p -> @', "L002", "@"],
			['["先行😀😀", ] >> p', "P003", "]"],
		])("maps the %s diagnostic to the exact offending source span", (body, code, token) => {
			const prefix = withFrontmatter
				? ["---", "title: Keep", "---", ""].join(eol)
				: "";
			const source = prefix + body + eol;
			const diagnostic = analyzeSnapshot(source).diagnostics.find(
				(d) => d.code === code,
			)!;
			expect(diagnostic).toBeDefined();
			expect(
				source.slice(
					diagnostic.range.start.offset,
					diagnostic.range.end.offset,
				),
			).toBe(token);
			const line = source.split("\n")[diagnostic.range.start.line - 1]!;
			expect(
				line.slice(
					diagnostic.range.start.column - 1,
					diagnostic.range.end.column - 1,
				),
			).toBe(token);
		});
	});

	it("preserves frontmatter diagnostics and document-wide zero ranges", () => {
		const source = [
			"---",
			"type: pipeline",
			'artifact: {"成果😀": {status: done}}',
			"---",
			'"成果😀" >> p -> "成果😀"',
			"",
		].join(eol);
		const raw = analyzeSource(source);
		const model = analyzeSnapshot(source);
		expect(model.sourceMap).toEqual(raw.sourceMap);
		expect(model.diagnostics.filter((d) => !/^[LP]\d+$/.test(d.code))).toEqual(
			raw.diagnostics.filter((d) => !/^[LP]\d+$/.test(d.code)),
		);
		expect(model.diagnostics.some((d) => d.code === "V010")).toBe(true);
		expect(model.diagnostics.some((d) => d.code === "W007")).toBe(true);
	});
});

it("retains raw YAML dependency coordinates after removing only the wrapper", () => {
	const source = 'title: "先行😀"\ngroup: {g: {parent: 2}}\n';
	const diagnostic = analyzeDependencySnapshot(
		"/project/preset.yaml",
		source,
	).diagnostics.find((d) => d.code === "FM004")!;
	expect(
		source.slice(diagnostic.range.start.offset, diagnostic.range.end.offset),
	).toBe("2");
	expect(diagnostic.range.start.line).toBe(2);
});

it.each(["ascii", "日本語"])("retains ordinary editor columns for %s", (id) => {
	const source = `input >> p -> ${id}\n`;
	const model = analyzeSnapshot(source);
	const range = findNodeOccurrenceRanges(model, source, id)[0]!;
	expect(range.start.column).toBe(source.indexOf(id) + 1);
	expect(range.end.column).toBe(source.indexOf(id) + id.length + 1);
});

it.each([
	"\n",
	"\r\n",
])("adapts every statement and expression endpoint without mutating core (%j)", (eol) => {
	const prefix = ["---", "title: Keep", "---", ""].join(eol);
	const body = [
		'["成果😀", 日本語] >> p -> "次😀" >> q',
		'"成果😀" >> p',
		'"成果😀" >>? p',
		'p -> "成果😀"',
		'"成果😀"',
		"",
	].join(eol);
	const source = prefix + body;
	const raw = analyzeSource(source);
	const before = structuredClone(raw.document);
	const model = analyzeSnapshot(source);
	expect(model.document.statements.map((s) => s.type)).toEqual([
		"chain",
		"input-edge",
		"feedback-edge",
		"output-edge",
		"node-decl",
	]);
	function assertEndpoints(value: unknown) {
		if (Array.isArray(value)) {
			for (const child of value) assertEndpoints(child);
		} else if (value && typeof value === "object") {
			if ("offset" in value && "line" in value && "column" in value) {
				const position = value as {
					offset: number;
					line: number;
					column: number;
				};
				const previous = source.slice(0, position.offset).split("\n");
				expect(position.line).toBe(previous.length);
				expect(position.column).toBe(previous.at(-1)!.length + 1);
			} else {
				for (const child of Object.values(value)) assertEndpoints(child);
			}
		}
	}
	assertEndpoints(model.document);
	expect(raw.document).toEqual(before);
	expect(raw.document.statements[0]!.start.offset).toBe(0);
});
