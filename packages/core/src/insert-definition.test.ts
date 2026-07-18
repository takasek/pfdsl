import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { insertDefinition } from "./insert-definition.js";

/** Apply an `insertion` the same way a minimal-edit consumer (e.g. VS Code's
 * WorkspaceEdit.insert) would: splice `text` in before line `line`, touching
 * nothing else in `source`. Used to prove `insertion` is consistent with
 * `output` without hand-computing line numbers per fixture. */
function applyInsertion(
	source: string,
	insertion: { line: number; text: string },
): string {
	const lines = source.split("\n");
	const insertLines = insertion.text.split("\n");
	// insertion.text always ends with "\n", so split() leaves a trailing "".
	insertLines.pop();
	lines.splice(insertion.line, 0, ...insertLines);
	return lines.join("\n");
}

describe("insertDefinition", () => {
	it("inserts a new block into an existing section", () => {
		const src = `---
artifact:
  a:
    label: A
process:
  p:
    label: P
---
a >> p -> b
`;
		const { output, inserted, insertion } = insertDefinition(
			src,
			"artifact",
			"b",
		);
		expect(inserted).toBe(true);
		const { frontmatter } = analyze(output);
		expect(frontmatter?.artifact?.b?.label).toBe("b");
		// existing definitions are untouched
		expect(frontmatter?.artifact?.a?.label).toBe("A");
		// insertion is a minimal edit: splicing it into the original source
		// (untouched elsewhere) reproduces output exactly
		expect(insertion).toBeDefined();
		expect(applyInsertion(src, insertion!)).toBe(output);
	});

	it("creates the section when it doesn't exist yet", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { output, inserted, insertion } = insertDefinition(
			src,
			"process",
			"p",
		);
		expect(inserted).toBe(true);
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.p?.label).toBe("p");
		expect(insertion).toBeDefined();
		expect(applyInsertion(src, insertion!)).toBe(output);
	});

	it("synthesizes front matter when the document has none", () => {
		const src = "a >> p -> b\n";
		const { output, inserted, insertion } = insertDefinition(
			src,
			"process",
			"p",
		);
		expect(inserted).toBe(true);
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.p?.label).toBe("p");
		expect(insertion).toEqual({ line: 0, text: expect.any(String) });
		expect(applyInsertion(src, insertion!)).toBe(output);
	});

	it("is a no-op when the node is already defined", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { output, inserted, insertion } = insertDefinition(
			src,
			"artifact",
			"a",
		);
		expect(inserted).toBe(false);
		expect(output).toBe(src);
		expect(insertion).toBeUndefined();
	});

	it("is idempotent: re-running after insertion is a no-op", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const first = insertDefinition(src, "artifact", "b");
		const second = insertDefinition(first.output, "artifact", "b");
		expect(second.inserted).toBe(false);
		expect(second.output).toBe(first.output);
	});

	it("locates the section header even with a trailing comment", () => {
		const src = `---
artifact: # user artifacts
  a:
    label: A
---
a >> p -> b
`;
		const { output, inserted } = insertDefinition(src, "artifact", "b");
		expect(inserted).toBe(true);
		const { frontmatter, diagnostics } = analyze(output);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(frontmatter?.artifact?.b?.label).toBe("b");
		expect(frontmatter?.artifact?.a?.label).toBe("A");
	});

	it("is a safe no-op when the section is an inline flow-style one-liner", () => {
		const src = `---
artifact: { a: { label: A } }
---
a >> p -> b
`;
		const { output, inserted, insertion } = insertDefinition(
			src,
			"artifact",
			"b",
		);
		expect(inserted).toBe(false);
		expect(output).toBe(src);
		expect(insertion).toBeUndefined();
	});

	it("matches the section's existing indent width", () => {
		const src = `---
artifact:
    a:
        label: A
---
a >> p -> b
`;
		const { output } = insertDefinition(src, "artifact", "b");
		expect(output).toContain("    b:\n        label: b");
	});
});
