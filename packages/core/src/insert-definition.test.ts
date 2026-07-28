import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { insertDefinition } from "./insert-definition.js";

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
		const { output, inserted } = insertDefinition(src, "artifact", "b");
		expect(inserted).toBe(true);
		expect(output).toContain("b:\n    label: b");
		// existing definitions are untouched
		expect(output).toContain("a:\n    label: A");
	});

	it("creates the section when it doesn't exist yet", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { output, inserted } = insertDefinition(src, "process", "p");
		expect(inserted).toBe(true);
		expect(output).toContain("process:\n  p:\n    label: p");
	});

	it("synthesizes front matter when the document has none", () => {
		const src = "a >> p -> b\n";
		const { output, inserted } = insertDefinition(src, "process", "p");
		expect(inserted).toBe(true);
		expect(output).toBe("---\nprocess:\n  p:\n    label: p\n---\n");
	});

	it("is a no-op when the node is already defined", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { output, inserted } = insertDefinition(src, "artifact", "a");
		expect(inserted).toBe(false);
		expect(output).toBe("---\nartifact:\n  a:\n    label: A\n---\n");
	});

	it("is idempotent: re-running after insertion is a no-op", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const fmBlock = src.slice(0, src.length - "a >> p -> b\n".length);
		const first = insertDefinition(src, "artifact", "b");
		// Simulate the caller replacing the frontmatter range with `first.output`
		// (a full document is what insertDefinition would receive on a real
		// second run; here we only need the frontmatter block to stay stable).
		const second = insertDefinition(
			`${first.output}a >> p -> b\n`,
			"artifact",
			"b",
		);
		expect(second.inserted).toBe(false);
		expect(second.output).toBe(first.output);
		expect(fmBlock).not.toBe(first.output);
	});

	it("locates the section even with a trailing comment on its header", () => {
		const src = `---
artifact: # user artifacts
  a:
    label: A
---
a >> p -> b
`;
		const { output, inserted } = insertDefinition(src, "artifact", "b");
		expect(inserted).toBe(true);
		// The yaml CST (ADR-0034) re-serializes the header's trailing comment
		// onto its own line when the section's map is otherwise rewritten —
		// the comment itself is preserved, just not its exact line placement.
		expect(output).toContain("artifact:\n  # user artifacts\n");
		const { diagnostics } = analyze(`${output}a >> p -> b\n`);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(output).toContain("b:\n    label: b");
		expect(output).toContain("a:\n    label: A");
	});

	it("writes into an inline flow-style section (#493-equivalent case)", () => {
		// Originally a regression test asserting a safe no-op: the surgical
		// writer had to skip a flow-style section entirely (splicing a
		// block-style entry into a one-liner would have produced broken YAML,
		// and re-appending a second top-level `artifact:` header would be a
		// duplicate key). The yaml CST (ADR-0034) writes into flow maps
		// natively, so this now succeeds.
		const src = `---
artifact: { a: { label: A } }
---
a >> p -> b
`;
		const { output, inserted } = insertDefinition(src, "artifact", "b");
		expect(inserted).toBe(true);
		expect(output).toBe(
			"---\nartifact: { a: { label: A }, b: { label: b } }\n---\n",
		);
	});

	it("normalizes an unusual indent width to the canonical 2-space step", () => {
		// The yaml CST (ADR-0034) re-serializes the whole frontmatter block, so
		// an oddly-indented section is canonicalized rather than mirrored.
		const src = `---
artifact:
    a:
        label: A
---
a >> p -> b
`;
		const { output } = insertDefinition(src, "artifact", "b");
		expect(output).toContain("  b:\n    label: b");
	});

	it("does not throw when the fences are well-formed but the YAML content is invalid (FM002)", () => {
		const src = "---\n: bad: yaml\n---\na >> p -> b\n";
		expect(() => insertDefinition(src, "artifact", "b")).not.toThrow();
		const { inserted } = insertDefinition(src, "artifact", "b");
		expect(inserted).toBe(false);
	});
});
