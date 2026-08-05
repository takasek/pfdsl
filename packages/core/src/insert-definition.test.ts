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
		// splice 方式では一行コメントの元位置がそのまま残る(#issue)
		expect(output).toContain(
			"artifact: # user artifacts\n  a:\n    label: A\n",
		);
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

	it("mirrors an unusual indent width instead of normalizing it", () => {
		// indentation normalization is fmt's job, not insertDefinition's;
		// splicing mirrors whatever step the file already uses (#issue)
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

	it("does not throw when the fences are well-formed but the YAML content is invalid (FM002)", () => {
		const src = "---\n: bad: yaml\n---\na >> p -> b\n";
		expect(() => insertDefinition(src, "artifact", "b")).not.toThrow();
		const { inserted } = insertDefinition(src, "artifact", "b");
		expect(inserted).toBe(false);
	});

	// newEntrySplice anchors the new entry's insertion position on the
	// section's last existing sibling. When that sibling is an explicit-key
	// entry (`? b`, no value line — legal YAML, `Pair.value` is genuinely
	// `null`), the anchor dereference used to crash with a TypeError
	// (final-review I3); it must instead fall back to full re-serialization,
	// same as the other unsupported shapes above.
	it("falls back to full re-serialization when the section's last sibling is explicit-key null", () => {
		const src = `---
artifact:
  a:
    label: A
  ? b
---
a >> p -> c
`;
		expect(() => insertDefinition(src, "artifact", "c")).not.toThrow();
		const { output, inserted } = insertDefinition(src, "artifact", "c");
		expect(inserted).toBe(true);
		const { diagnostics, frontmatter } = analyze(`${output}a >> p -> c\n`);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(frontmatter?.artifact?.c?.label).toBe("c");
		expect(frontmatter?.artifact?.a?.label).toBe("A");
	});

	// The block returned here is spliced into the caller's document, so it has
	// to arrive in that document's line ending or the splice mixes the two.
	it("emits a CRLF block for a CRLF source (#644)", () => {
		const src = [
			"---",
			"artifact:",
			"  a:",
			"    label: A",
			"---",
			"a >> p -> b",
			"",
		].join("\r\n");
		const { output, inserted } = insertDefinition(src, "artifact", "b");
		expect(inserted).toBe(true);
		expect(output.replace(/\r\n/g, "")).not.toContain("\n");
	});
});
