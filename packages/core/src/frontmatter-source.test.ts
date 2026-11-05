import { describe, expect, it } from "vitest";
import { analyze, analyzeSource, format, loadFrontmatter } from "./index.js";

describe("source snapshot", () => {
	it("shares semantic values and CRLF/escaped authored ranges without rewriting", () => {
		const source =
			'---\r\n"artifact": {"label": {location: ["docs/a\\u002cb.md"]}}\r\nprocess: {build: {command: "make build"}}\r\n---\r\nlabel >> build -> out\r\n';
		const model = analyzeSource(source);
		const declaration = model.sourceMap.declarations[0]!;
		expect(declaration.id).toBe("label");
		expect(
			source.slice(
				declaration.range.start.offset,
				declaration.range.end.offset,
			),
		).toBe('"label"');
		const value = declaration.fields.get("location")!.values[0]!;
		expect(value.value).toBe("docs/a,b.md");
		expect(source.slice(value.range.start.offset, value.range.end.offset)).toBe(
			"docs/a\\u002cb.md",
		);
		expect(value.range.start.line).toBe(2);
		expect(model.frontmatter?.artifact?.label?.location).toEqual([value.value]);
		const { sourceMap: _sourceMap, ...result } = model;
		expect(result).toEqual(analyze(source));
		expect(loadFrontmatter(source)).not.toHaveProperty("sourceMap");
	});

	it("preserves strict inline comment diagnostics and leaves unrelated source intact", () => {
		const source =
			"---\nartifact:\n  a:\n    label: name # note\nprocess:\n  p:\n    command: >-\n      make\n      build\n---\na >> p -> b\n";
		expect(
			analyzeSource(source).diagnostics.find((d) => d.code === "FM003")
				?.severity,
		).toBe("warning");
		expect(
			analyzeSource(source, { strict: true }).diagnostics.find(
				(d) => d.code === "FM003",
			)?.severity,
		).toBe("error");
		expect(format(source).output).toContain(
			"    command: >-\n      make\n      build\n",
		);
		expect(format(source).output).toContain("label: name # note");
	});

	it("locates aliases at their use and terminates recursive extension metadata", () => {
		const source =
			"---\nmeta: &m {location: [docs/a.md]}\nrecursive: &r [*r]\nartifact: {a: *m}\nprocess: {p: {command: &c make, extra: *r}}\n---\na >> p -> b\n";
		const model = analyzeSource(source);
		const value =
			model.sourceMap.declarations[0]!.fields.get("location")!.values[0]!;
		expect(value.value).toBe("docs/a.md");
		expect(source.slice(value.range.start.offset, value.range.end.offset)).toBe(
			"*m",
		);
	});

	it("locates aliased sections at their use site and resolves aliased section keys", () => {
		const source =
			"---\nkey: &key process\nmetadata: &nodes {a: {location: docs/a.md}}\nartifact: *nodes\n*key : {p: {command: make}}\n---\na >> p -> b\n";
		const model = analyzeSource(source);
		expect(model.frontmatter?.process?.p?.command).toBe("make");
		const artifact = model.sourceMap.declarations.find((d) => d.id === "a")!;
		const value = artifact.fields.get("location")!.values[0]!;
		expect(source.slice(value.range.start.offset, value.range.end.offset)).toBe(
			"*nodes",
		);
		expect(artifact.fields.get("location")?.keyRange).toEqual(artifact.range);
		expect(
			model.sourceMap.declarations
				.find((d) => d.id === "p")
				?.fields.get("command")?.values[0]?.value,
		).toBe("make");
	});

	it("keeps empty, unclosed, malformed and invalid metadata out of consumers", () => {
		for (const source of [
			"a >> p -> b",
			"---\nartifact:",
			"---\nartifact: [\n---\n",
			"---\nartifact: {a: {location: [3]}}\n---\n",
		]) {
			const model = analyzeSource(source);
			expect(model.frontmatter).toBeNull();
		}
	});
});
