import { describe, expect, it } from "vitest";
import { analyzeSnapshot } from "./document.js";
import {
	compareDocumentSources,
	documentReferences,
	joinReferencePath,
	resolveDocumentReference as resolveScopedDocumentReference,
} from "./references.js";

function resolveDocumentReference(
	path: string | null,
	reference: {
		field: "location" | "subflow";
		value: string;
		kind?: "artifact" | "process";
		id?: string;
	},
	basePath?: string,
	frontmatter?: Parameters<
		typeof resolveScopedDocumentReference
	>[2]["frontmatter"],
) {
	return resolveScopedDocumentReference(
		path,
		{
			kind: reference.field === "subflow" ? "process" : "artifact",
			id: "a",
			...reference,
		},
		{
			frontmatter: {
				...frontmatter,
				...(basePath === undefined ? {} : { basePath }),
			},
			diagnostics: [],
		},
	);
}

describe("document reference and comparison contracts", () => {
	it.each([
		"baseRef: main",
		'baseRef: ""',
		"baseRef: null",
		"baseRef: {source: r}",
		"artifact: {a: {ref: 3}}",
	])("refuses invalid front matter before resolving paths: %s", (declaration) => {
		const model = analyzeSnapshot(`---\n${declaration}\n---\na >> p -> b\n`);
		expect(() =>
			resolveScopedDocumentReference(
				"/w/a.pfdsl",
				{ kind: "artifact", id: "a", field: "location", value: "x.md" },
				model,
			),
		).toThrow("Fix front matter errors before opening references.");
	});
	it.each([
		"a >> p -> b\n",
		"---\n---\na >> p -> b\n",
	])("resolves documents without declarations: %s", (source) => {
		expect(
			resolveScopedDocumentReference(
				"/w/a.pfdsl",
				{ kind: "artifact", id: "a", field: "location", value: "x.md" },
				analyzeSnapshot(source),
			),
		).toEqual({ kind: "path", value: "/w/x.md" });
	});
	it("still refuses a reference with an extra key", () => {
		expect(() =>
			resolveScopedDocumentReference(
				"/w/a.pfdsl",
				{ kind: "artifact", id: "a", field: "location", value: "x.md" },
				analyzeSnapshot(
					"---\nbaseRef: {source: r, revision: m, extra: true}\n---\na >> p -> b\n",
				),
			),
		).toThrow();
	});
	it.each([
		{
			kind: "artifact",
			id: "a",
			field: "location",
			value: "https://example.com/a",
		},
		{ kind: "process", id: "p", field: "subflow", value: "child.pfdsl" },
	] as const)("refuses FM errors before early returns: %j", (reference) => {
		expect(() =>
			resolveScopedDocumentReference(
				"/w/a.pfdsl",
				reference,
				analyzeSnapshot("---\nbaseRef: main\n---\na >> p -> b\n"),
			),
		).toThrow("Fix front matter errors before opening references.");
	});
	it("allows warning-only front matter diagnostics", () => {
		const model = analyzeSnapshot(
			"---\nartifact:\n  a:\n    label: Plan # note\n---\na >> p -> b\n",
		);
		expect(model.diagnostics).toContainEqual(
			expect.objectContaining({ code: "FM003", severity: "warning" }),
		);
		expect(
			resolveScopedDocumentReference(
				"/w/a.pfdsl",
				{ kind: "artifact", id: "a", field: "location", value: "x.md" },
				model,
			),
		).toEqual({ kind: "path", value: "/w/x.md" });
	});
	it("retains the owning node when references have the same spelling", () => {
		const model = analyzeSnapshot(
			"---\nartifact: {a: {location: plan.md}}\nprocess: {p: {location: plan.md, subflow: child.pfdsl}}\n---\na >> p -> b\n",
		);
		expect(
			documentReferences(model).map(({ kind, id, field }) => [kind, id, field]),
		).toEqual([
			["artifact", "a", "location"],
			["process", "p", "location"],
			["process", "p", "subflow"],
		]);
	});
	it.each([
		"baseRef",
		"ref",
	])("does not resolve an explicit artifact %s to the local checkout", (field) => {
		const target = { source: "repo", revision: "main" };
		const fm =
			field === "baseRef"
				? { baseRef: target }
				: { artifact: { a: { ref: target } } };
		expect(() =>
			resolveDocumentReference(
				"/work/a.pfdsl",
				{ kind: "artifact", id: "a", field: "location", value: "plan.md" },
				undefined,
				fm,
			),
		).toThrow(/resolution context/);
		expect(
			resolveDocumentReference(
				"/work/a.pfdsl",
				{ kind: "process", id: "p", field: "location", value: "plan.md" },
				undefined,
				fm,
			),
		).toEqual({ kind: "path", value: "/work/plan.md" });
		expect(
			resolveDocumentReference(
				"/work/a.pfdsl",
				{
					kind: "artifact",
					id: "a",
					field: "location",
					value: "https://example.com/plan",
				},
				undefined,
				fm,
			),
		).toEqual({ kind: "url", value: "https://example.com/plan" });
	});
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
