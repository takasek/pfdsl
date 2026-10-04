import { analyze } from "@pfdsl/core";
import { findFrontmatterDefinitionInText } from "@pfdsl/editor";
import { describe, expect, it } from "vitest";
import { declaredCommands, runHintAnchors } from "./codelens-logic.js";
import { extractDocumentLinks } from "./document-link-logic.js";

const corpus = [
	`---
artifact:
  first:
    label: Wrong target
  "label": {location: ["docs/a,b.md"]} # keep this comment
process:
  "build": {command: "make build", subflow: child.pfdsl}
---
first >> build -> label
`,
	`---
artifact: {first: {label: Wrong target}, 'label': {location: ['docs/a,b.md']}}
process:
  build:
    command: >-
      make
      build
    subflow: child.pfdsl # a comment
---
first >> build -> label
`,
];

it("does not attach a run hint or link to matching extension metadata", () => {
	const source = `---
artifact: {a: {extra: {command: make, location: wrong.md}}}
process: {p: {command: make}}
---
a >> p -> b
`;
	const result = analyze(source);
	expect(extractDocumentLinks(source, "/repo/main.pfdsl")).toEqual([]);
	expect(
		runHintAnchors(
			source.split("\n"),
			result.bodyStartLine,
			declaredCommands(result.frontmatter?.process),
		),
	).toEqual([
		{ line: 2, column: source.split("\n")[2]!.length, command: "make" },
	]);
});

describe.each(corpus)("shared authored document corpus", (source) => {
	it("jumps to the declaration rather than a field with the same name", () => {
		const pos = findFrontmatterDefinitionInText(source, "label")!;
		expect(pos).toBeDefined();
		expect(source.split("\n")[pos.line]?.slice(pos.column)).toMatch(
			/^["']label["']:/,
		);
	});

	it("links decoded values with exact source ranges", () => {
		const links = extractDocumentLinks(source, "/repo/main.pfdsl");
		expect(links.map((link) => link.target)).toEqual([
			"file:///repo/docs/a,b.md",
			"file:///repo/child.pfdsl",
		]);
		const location = links[0]!;
		expect(
			source
				.split("\n")
				[location.line]?.slice(location.startChar, location.endChar),
		).toBe("docs/a,b.md");
	});

	it("runs the semantic command, including flow and folded scalars", () => {
		const result = analyze(source);
		const hints = runHintAnchors(
			source.split("\n"),
			result.bodyStartLine,
			declaredCommands(result.frontmatter?.process),
		);
		expect(hints).toHaveLength(1);
		expect(hints[0]?.command).toBe("make build");
		expect(source.split("\n")[hints[0]!.line]).toContain("command:");
	});

	it("points validation diagnostics at the authored declaration", () => {
		const invalid = source
			.replace("---\n", "---\ntype: pipeline\n")
			.replace("location:", "status: done, location:");
		const result = analyze(invalid);
		const diag = result.diagnostics.find((d) => d.code === "W007")!;
		expect(diag).toBeDefined();
		expect(
			invalid.slice(diag.range.start.offset, diag.range.end.offset),
		).toMatch(/^["']label["']$/);
	});
});
