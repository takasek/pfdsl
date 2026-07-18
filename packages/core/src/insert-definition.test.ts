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
		const { frontmatter } = analyze(output);
		expect(frontmatter?.artifact?.b?.label).toBe("b");
		// existing definitions are untouched
		expect(frontmatter?.artifact?.a?.label).toBe("A");
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
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.p?.label).toBe("p");
	});

	it("synthesizes front matter when the document has none", () => {
		const src = "a >> p -> b\n";
		const { output, inserted } = insertDefinition(src, "process", "p");
		expect(inserted).toBe(true);
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.p?.label).toBe("p");
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
		expect(output).toBe(src);
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
