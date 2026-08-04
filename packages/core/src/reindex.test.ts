import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { reindex } from "./reindex.js";

/** Parse the index: values back out of a reindexed source, per kind. */
function indices(src: string): {
	artifact: Record<string, number | undefined>;
	process: Record<string, number | undefined>;
} {
	const { frontmatter } = analyze(src);
	const artifact: Record<string, number | undefined> = {};
	const process: Record<string, number | undefined> = {};
	for (const [id, m] of Object.entries(frontmatter?.artifact ?? {}))
		artifact[id] = m.index;
	for (const [id, m] of Object.entries(frontmatter?.process ?? {}))
		process[id] = m.index;
	return { artifact, process };
}

describe("reindex", () => {
	it("renumber: assigns topological indices with independent counters", () => {
		const src = `---
artifact:
  a: { label: A }
  b: { label: B }
process:
  p: { label: P }
---
a >> p -> b
`;
		const { output, changes } = reindex(src, { renumber: true });
		const idx = indices(output);
		// a is a source artifact (rank 0) → artifact #1; b is output → artifact #2
		expect(idx.artifact.a).toBe(1);
		expect(idx.artifact.b).toBe(2);
		// p is the only process → process #1
		expect(idx.process.p).toBe(1);
		expect(changes).toHaveLength(3);
	});

	it("renumber is idempotent: re-running yields no changes", () => {
		const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
---
a >> p -> b
`;
		const first = reindex(src, { renumber: true });
		const second = reindex(first.output, { renumber: true });
		expect(second.changes).toHaveLength(0);
		expect(second.output).toBe(first.output);
	});

	it("fill (default): preserves existing indices, assigns only the missing", () => {
		const src = `---
artifact:
  a:
    index: 5
    label: A
  b:
    label: B
process:
  p:
    label: P
---
a >> p -> b
`;
		const { output, changes } = reindex(src);
		const idx = indices(output);
		expect(idx.artifact.a).toBe(5); // preserved
		expect(idx.artifact.b).toBe(6); // max(5)+1
		expect(idx.process.p).toBe(1); // process namespace independent
		// only the two newly-assigned nodes are reported
		expect(changes.map((c) => c.id).sort()).toEqual(["b", "p"]);
		const bChange = changes.find((c) => c.id === "b");
		expect(bChange).toMatchObject({ kind: "artifact", from: null, to: 6 });
	});

	it("fill: no change when every node already has an index", () => {
		const src = `---
artifact:
  a:
    index: 1
  b:
    index: 2
process:
  p:
    index: 1
---
a >> p -> b
`;
		const { changes, output } = reindex(src);
		expect(changes).toHaveLength(0);
		expect(output).toBe(src);
	});

	it("renumber: updates an existing index value in place", () => {
		const src = `---
artifact:
  a:
    index: 9
    label: A
  b:
    label: B
process:
  p:
    label: P
---
a >> p -> b
`;
		const { output, changes } = reindex(src, { renumber: true });
		const idx = indices(output);
		expect(idx.artifact.a).toBe(1);
		const aChange = changes.find((c) => c.id === "a");
		expect(aChange).toMatchObject({ from: 9, to: 1 });
		// the label line is preserved
		expect(output).toContain("label: A");
	});

	it("creates a frontmatter entry for a body-only node", () => {
		const src = `a >> p -> b\n`;
		const { output } = reindex(src, { renumber: true });
		const idx = indices(output);
		expect(idx.artifact.a).toBe(1);
		expect(idx.artifact.b).toBe(2);
		expect(idx.process.p).toBe(1);
		// body is preserved
		expect(output).toContain("a >> p -> b");
	});

	it("preserves an untouched folded-scalar sibling's line wraps, even when the same batch also creates brand-new entries", () => {
		const src = [
			"---",
			"artifact:",
			"  a:",
			"    label: A",
			"    description: >",
			"      long text",
			"      wrapped here",
			"---",
			"a >> p -> b",
			"",
		].join("\n");
		const { output } = reindex(src, { renumber: true });
		expect(output).toContain(
			"description: >\n      long text\n      wrapped here\n",
		);
		// p (process, body-only) and b (artifact, body-only) both get a fresh
		// frontmatter entry with an index in the same pass.
		expect(output).toContain("process:\n  p:\n    index: 1");
		expect(output).toMatch(/b:\n\s*index: 2/);
	});

	it("keeps independent brand-new entries under their own parent section even when all splices land at the same offset (#corruption)", () => {
		// a is the sole entry in artifact: and the last thing in the file, so
		// three independent splices (extend a's fields, create process:, append
		// to artifact:) all anchor on the exact same byte offset. A batched
		// single-pass apply concatenated their replacement texts in whatever
		// order the stable sort produced, nesting b (an artifact) as a YAML
		// sibling of p under process: instead of under artifact:.
		const src = [
			"---",
			"artifact:",
			"  a:",
			"    label: A",
			"    description: >",
			"      long text",
			"      wrapped here",
			"---",
			"a >> p -> b",
			"",
		].join("\n");
		const { output } = reindex(src, { renumber: true });
		const { frontmatter } = analyze(output);
		expect(frontmatter?.artifact?.a?.index).toBe(1);
		expect(frontmatter?.process?.p?.index).toBe(1);
		expect(frontmatter?.artifact?.b?.index).toBe(2);
		// b must NOT have ended up nested under process:.
		expect(Object.keys(frontmatter?.process ?? {}).sort()).toEqual(["p"]);
		expect(Object.keys(frontmatter?.artifact ?? {}).sort()).toEqual(["a", "b"]);
	});

	it("handles 4-space indented front matter without corrupting it", () => {
		const src = `---
artifact:
    req:
        label: Req
    spec:
        label: Spec
process:
    design:
        label: Design
---
req >> design -> spec
`;
		const { output } = reindex(src, { renumber: true });
		// output must still parse (no duplicate keys / mixed indent)
		const { diagnostics } = analyze(output);
		expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
		const idx = indices(output);
		expect(idx.artifact.req).toBe(1);
		expect(idx.process.design).toBe(1);
	});

	it("updates an inline mapping that has a trailing comment", () => {
		const src = `---
artifact:
  req: { index: 9 } # important
  spec: {}
process:
  design: {}
---
req >> design -> spec
`;
		const { output } = reindex(src, { renumber: true });
		const { diagnostics } = analyze(output);
		expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
		const idx = indices(output);
		expect(idx.artifact.req).toBe(1);
		// trailing comment is preserved
		expect(output).toContain("# important");
	});

	it("does not corrupt an inline mapping whose trailing comment contains braces", () => {
		const src = `---
artifact:
  a: { label: A } # see {x} and more
  b: {}
process:
  p: {}
---
a >> p -> b
`;
		const { output } = reindex(src, { renumber: true });
		const { diagnostics } = analyze(output);
		expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
		const idx = indices(output);
		expect(idx.artifact.a).toBe(1);
		// the comment (and its braces) survive intact
		expect(output).toContain("# see {x} and more");
	});

	it("preserves spacing when updating the last key of an inline mapping", () => {
		const src = `---
artifact:
  spec: {}
process:
  design: { index: 5 }
---
spec >> design -> out
`;
		const { output } = reindex(src, { renumber: true });
		expect(output).toContain("{ index: 1 }");
		expect(output).not.toContain("{ index: 1}");
	});

	it("writes into a node in an inline flow-style section one-liner (#493)", () => {
		// Originally a regression test for the surgical writer, which had to
		// skip a flow-style section entirely (splicing a block-style `index:`
		// line into a one-liner would have produced broken YAML). The yaml CST
		// (ADR-0034) writes into flow maps natively, so this now succeeds.
		const src = `---
artifact: { a: { label: A } }
process:
  p:
    label: P
---
a >> p -> b
`;
		const { output, changes, diagnostics } = reindex(src, { renumber: true });
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(output).toContain("artifact: { a: { label: A, index: 1 }");
		expect(changes.some((c) => c.id === "a")).toBe(true);
		// the ordinary block-style process section still gets its index
		expect(changes.some((c) => c.id === "p")).toBe(true);
		const { diagnostics: reparsed } = analyze(output);
		expect(reparsed.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("returns diagnostics and leaves source unchanged on parse error", () => {
		const src = `a >> >> b\n`;
		const { output, changes, diagnostics } = reindex(src);
		expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
		expect(changes).toHaveLength(0);
		expect(output).toBe(src);
	});

	// newEntrySplice (used here for a brand-new node with no frontmatter
	// entry yet, e.g. `c` below) anchors on the kind section's last existing
	// sibling. When that sibling is an explicit-key entry (`? b`, no value
	// line — `Pair.value` is genuinely `null`), the anchor dereference used
	// to crash with a TypeError (final-review I3); reindex must instead take
	// its existing full-re-serialize fallback, same as any other
	// newEntrySplice-declined shape.
	it("falls back to full re-serialization when the anchor sibling is explicit-key null", () => {
		const src = [
			"---",
			"artifact:",
			"  a:",
			"    label: A",
			"  ? b",
			"---",
			"a >> p -> c",
			"",
		].join("\n");
		expect(() => reindex(src, { renumber: true })).not.toThrow();
		const { output, changes, diagnostics } = reindex(src, { renumber: true });
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(changes.some((c) => c.id === "c")).toBe(true);
		const idx = indices(output);
		expect(idx.artifact.a).toBe(1);
		expect(idx.artifact.c).toBe(2);
	});

	it("keeps a CRLF source on CRLF (#644)", () => {
		const src = [
			"---",
			"artifact:",
			"  a: { label: A }",
			"  b: { label: B }",
			"---",
			"a >> p -> b",
			"",
		].join("\r\n");
		const { output, changes } = reindex(src);
		expect(changes.length).toBeGreaterThan(0);
		expect(output.replace(/\r\n/g, "")).not.toContain("\n");
	});
});
