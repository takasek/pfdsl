import { analyzeSource } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	findFrontmatterDefinitionInText,
	findNodeOccurrenceRanges,
	nextNodeOccurrenceRange,
	nodeIdAtSourcePosition,
} from "./jump-logic.js";

const FM_SOURCE = `---
artifact:
  spec_doc: {}
  result: {}
process:
  build: {}
---
spec_doc >> build -> result
`;

describe("findFrontmatterDefinitionInText", () => {
	it("finds an artifact id in the frontmatter", () => {
		const pos = findFrontmatterDefinitionInText(FM_SOURCE, "spec_doc");
		expect(pos).toBeDefined();
		expect(pos?.line).toBe(2);
		expect(pos?.column).toBe(2);
	});

	it("finds a process id in the frontmatter", () => {
		const pos = findFrontmatterDefinitionInText(FM_SOURCE, "build");
		expect(pos).toBeDefined();
		expect(pos?.line).toBe(5);
	});

	it("returns undefined for an id not in frontmatter", () => {
		const pos = findFrontmatterDefinitionInText(FM_SOURCE, "unknown");
		expect(pos).toBeUndefined();
	});

	it("returns undefined when there is no frontmatter", () => {
		const pos = findFrontmatterDefinitionInText("A >> P -> B\n", "A");
		expect(pos).toBeUndefined();
	});

	it("does not match body lines below frontmatter", () => {
		const src = `---
artifact:
  spec: {}
---
spec >> P
`;
		const pos = findFrontmatterDefinitionInText(src, "spec");
		expect(pos?.line).toBe(2);
	});

	it("returns column accounting for indentation", () => {
		const src = `---\nartifact:\n    deep_id: {}\n---\n`;
		const pos = findFrontmatterDefinitionInText(src, "deep_id");
		expect(pos?.column).toBe(4);
	});
});

const CYCLE_SOURCE = `---
artifact:
  "status": {}
  other:
    status: done
process:
  p: {}
---
status >> p -> status
status >>? p
`;

describe("semantic node occurrences", () => {
	it("lists the quoted definition key before every body occurrence in document order", () => {
		const ranges = findNodeOccurrenceRanges(
			analyzeSource(CYCLE_SOURCE),
			CYCLE_SOURCE,
			"status",
		);
		expect(
			ranges.map(({ start, end }) => [start.line, start.column, end.column]),
		).toEqual([
			[3, 3, 11],
			[9, 1, 7],
			[9, 16, 22],
			[10, 1, 7],
		]);
	});

	it("finds node IDs at quoted keys and at both ends of body tokens", () => {
		const model = analyzeSource(CYCLE_SOURCE);
		for (const position of [
			{ line: 2, character: 2 },
			{ line: 2, character: 9 },
			{ line: 8, character: 0 },
			{ line: 8, character: 6 },
			{ line: 8, character: 17 },
		]) {
			expect(nodeIdAtSourcePosition(model, CYCLE_SOURCE, position)).toBe(
				"status",
			);
		}
	});

	it("does not target a field, metadata value, section key, operator or blank position", () => {
		const model = analyzeSource(CYCLE_SOURCE);
		for (const position of [
			{ line: 4, character: 6 },
			{ line: 4, character: 13 },
			{ line: 1, character: 2 },
			{ line: 8, character: 8 },
			{ line: 0, character: 0 },
		]) {
			expect(
				nodeIdAtSourcePosition(model, CYCLE_SOURCE, position),
			).toBeUndefined();
			expect(
				nextNodeOccurrenceRange(model, CYCLE_SOURCE, position),
			).toBeUndefined();
		}
	});

	it("includes all AST statement kinds and each same-line repetition", () => {
		const source = "[a, a] >> p -> [a, a]\na >> p\na >>? p\np -> a\na\n";
		const ranges = findNodeOccurrenceRanges(analyzeSource(source), source, "a");
		expect(ranges.map(({ start }) => [start.line, start.column])).toEqual([
			[1, 2],
			[1, 5],
			[1, 17],
			[1, 20],
			[2, 1],
			[3, 1],
			[4, 6],
			[5, 1],
		]);
	});

	it("resolves a quoted and escaped YAML key by its semantic ID", () => {
		const source = '---\nprocess:\n  "b\\u0075ild": {}\n---\na >> build -> b\n';
		const ranges = findNodeOccurrenceRanges(
			analyzeSource(source),
			source,
			"build",
		);
		expect(ranges.map(({ start }) => [start.line, start.column])).toEqual([
			[3, 3],
			[5, 6],
		]);
		expect(
			nodeIdAtSourcePosition(analyzeSource(source), source, {
				line: 2,
				character: 6,
			}),
		).toBe("build");
	});

	it("excludes group and tag declarations with the same ID", () => {
		const source = "---\ngroup: {a: {}}\ntag: {a: {}}\n---\na\n";
		const model = analyzeSource(source);
		expect(findNodeOccurrenceRanges(model, source, "a")).toHaveLength(1);
		expect(
			nodeIdAtSourcePosition(model, source, { line: 1, character: 8 }),
		).toBeUndefined();
	});

	it("keeps aliased section IDs in the body and refuses the alias as a node key", () => {
		const source =
			"---\nmetadata: &nodes {a: {}, b: {}}\nartifact: *nodes\n---\na >> p -> b\na\n";
		const model = analyzeSource(source);
		expect(
			findNodeOccurrenceRanges(model, source, "a").map(
				({ start }) => start.line,
			),
		).toEqual([5, 6]);
		expect(
			nodeIdAtSourcePosition(model, source, { line: 2, character: 11 }),
		).toBeUndefined();
		expect(
			nextNodeOccurrenceRange(model, source, { line: 5, character: 0 })?.start,
		).toMatchObject({ line: 5, column: 1 });
	});

	it("refuses overlapping declaration ranges for different semantic IDs", () => {
		const model = analyzeSource(CYCLE_SOURCE);
		const declaration = model.sourceMap.declarations[0]!;
		model.sourceMap = {
			declarations: [declaration, { ...declaration, id: "other" }],
		};
		expect(
			nodeIdAtSourcePosition(model, CYCLE_SOURCE, { line: 2, character: 5 }),
		).toBeUndefined();
		expect(
			findNodeOccurrenceRanges(model, CYCLE_SOURCE, "status"),
		).toHaveLength(3);
	});
});

describe("nextNodeOccurrenceRange", () => {
	it("cycles definition, each body occurrence, and back to the definition", () => {
		const model = analyzeSource(CYCLE_SOURCE);
		let position = { line: 2, character: 5 };
		const visited = [];
		for (let i = 0; i < 4; i++) {
			const range = nextNodeOccurrenceRange(model, CYCLE_SOURCE, position)!;
			visited.push([range.start.line, range.start.column]);
			position = { line: range.end.line - 1, character: range.end.column - 1 };
		}
		expect(visited).toEqual([
			[9, 1],
			[9, 16],
			[10, 1],
			[3, 3],
		]);
	});

	it("starts at an interior body occurrence and advances from that occurrence", () => {
		const range = nextNodeOccurrenceRange(
			analyzeSource(CYCLE_SOURCE),
			CYCLE_SOURCE,
			{
				line: 8,
				character: 18,
			},
		);
		expect(range?.start).toMatchObject({ line: 10, column: 1 });
	});

	it("cycles body only when no definition exists", () => {
		const source = "a >> p -> a\na\n";
		const model = analyzeSource(source);
		expect(
			nextNodeOccurrenceRange(model, source, { line: 0, character: 0 })?.start,
		).toMatchObject({ line: 1, column: 11 });
		expect(
			nextNodeOccurrenceRange(model, source, { line: 1, character: 0 })?.start,
		).toMatchObject({ line: 1, column: 1 });
	});

	it("stays on a definition without body occurrences and on a sole body occurrence", () => {
		for (const [source, position] of [
			["---\nartifact: {a: {}}\n---\n", { line: 1, character: 11 }],
			["a\n", { line: 0, character: 0 }],
		] as const) {
			const model = analyzeSource(source);
			expect(nextNodeOccurrenceRange(model, source, position)).toEqual(
				findNodeOccurrenceRanges(model, source, "a")[0],
			);
		}
	});

	it("recomputes order after occurrences are added and removed", () => {
		const source = "a >> p -> a\n";
		const added = `${source}a\n`;
		expect(
			nextNodeOccurrenceRange(analyzeSource(added), added, {
				line: 0,
				character: 10,
			})?.start,
		).toMatchObject({ line: 2, column: 1 });
		expect(
			nextNodeOccurrenceRange(analyzeSource(source), source, {
				line: 0,
				character: 10,
			})?.start,
		).toMatchObject({ line: 1, column: 1 });
	});
});
