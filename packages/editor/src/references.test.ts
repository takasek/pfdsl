import { describe, expect, it } from "vitest";
import { analyzeSnapshot } from "./document.js";
import {
	compareDocumentSources,
	documentReferences,
	joinReferencePath,
	resolveDocumentReference,
} from "./references.js";

describe("document reference and comparison contracts", () => {
	it("extracts decoded values and authored ranges without matching field-like labels", () => {
		const source =
			'---\nbasePath: ../assets\nartifact: {"入力": {label: "location: wrong", location: ["one file.pfdsl", "https://example.org/a"]}}\nprocess: {p: {subflow: "child.pfdsl"}}\n---\n入力 >> p -> b\n';
		const refs = documentReferences(analyzeSnapshot(source));
		expect(refs.map(({ field, value }) => [field, value])).toEqual([
			["location", "one file.pfdsl"],
			["location", "https://example.org/a"],
			["subflow", "child.pfdsl"],
		]);
		for (const ref of refs)
			expect(
				source.slice(ref.range.start.offset, ref.range.end.offset),
			).toContain(ref.value);
	});
	it("resolves location and subflow with their different base rules", () => {
		expect(joinReferencePath("/work/space dir", "日本語.pfdsl")).toBe(
			"/work/space dir/日本語.pfdsl",
		);
		expect(() =>
			resolveDocumentReference(null, {
				field: "subflow",
				value: "child.pfdsl",
			}),
		).toThrow(/Save/);
		expect(
			resolveDocumentReference(
				"/work/docs/a.pfdsl",
				{ field: "location", value: "one.pfdsl" },
				"../assets",
			),
		).toEqual({ kind: "path", value: "/work/assets/one.pfdsl" });
		expect(
			resolveDocumentReference(
				"/work/docs/a.pfdsl",
				{ field: "subflow", value: "child.pfdsl" },
				"../assets",
			),
		).toEqual({ kind: "path", value: "/work/docs/child.pfdsl" });
		expect(
			resolveDocumentReference(
				"/work/docs/a.pfdsl",
				{ field: "location", value: "one.pfdsl" },
				"/ignored",
			),
		).toEqual({ kind: "path", value: "/work/docs/one.pfdsl" });
		expect(
			resolveDocumentReference(null, {
				field: "location",
				value: "https://example.org",
			}),
		).toEqual({ kind: "url", value: "https://example.org" });
		expect(
			resolveDocumentReference(null, {
				field: "location",
				value: "/absolute/a.pfdsl",
			}),
		).toEqual({ kind: "path", value: "/absolute/a.pfdsl" });
		expect(() =>
			resolveDocumentReference(null, { field: "location", value: "a.pfdsl" }),
		).toThrow(/Save/);
		expect(() =>
			resolveDocumentReference("/a.pfdsl", {
				field: "subflow",
				value: "/child.pfdsl",
			}),
		).toThrow(/relative/);
	});
	it("compares metadata-only changes in the same direction as VS Code and refuses broken input", () => {
		const a = "---\nartifact: {a: {label: Before}}\n---\na >> p -> b\n";
		const b = a.replace("Before", "After");
		expect(compareDocumentSources(a, b).changedNodes).toEqual(["a"]);
		expect(compareDocumentSources(a, `${a}b >> q -> c\n`).addedNodes).toEqual([
			"c",
			"q",
		]);
		expect(() => compareDocumentSources(a, '"broken')).toThrow(
			/diagnostic|parse|errors/i,
		);
	});
});
