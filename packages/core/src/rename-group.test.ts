import { describe, expect, it } from "vitest";
import { renameGroup } from "./rename-group.js";

describe("renameGroup", () => {
	it("renames the declaration key, keeping its position and comments", () => {
		// The comment relocates from the key's own line to its own line above
		// the value — that is the `yaml` package's own re-serialization of a
		// same-line trailing comment above a nested block map (reproducible
		// with parseDocument(src).toString() alone, with no rename involved),
		// the same CST round-trip `meta set` already goes through (ADR-0034).
		// What this test guards is that the comment's *text* survives and the
		// key's position among its siblings (before g2) is kept.
		const src = `---
group:
  g1: # first
    label: "Layer 1"
  g2:
    label: "Layer 2"
---
a
`;
		const { output, found } = renameGroup(src, "g1", "gx");
		expect(found).toBe(true);
		expect(output).toBe(`---
group:
  gx:
    # first
    label: "Layer 1"
  g2:
    label: "Layer 2"
---
a
`);
	});

	it("rewrites another group's parent: reference and reports it as a child", () => {
		const src = `---
group:
  g1:
    label: "Layer 1"
  g2:
    label: "Layer 2"
    parent: g1
---
a
`;
		const { output, children } = renameGroup(src, "g1", "gx");
		expect(children).toEqual(["g2"]);
		expect(output).toContain("parent: gx");
	});

	it("rewrites every artifact's and process's group: field and reports them as members, in declaration order", () => {
		const src = `---
group:
  g1:
    label: "Layer 1"
artifact:
  a:
    group: g1
  b:
    label: B
process:
  p:
    group: g1
---
a >> p -> b
`;
		const { output, members } = renameGroup(src, "g1", "gx");
		expect(members).toEqual(["a", "p"]);
		expect(output).toContain("a:\n    group: gx");
		expect(output).toContain("p:\n    group: gx");
	});

	it("leaves an unrelated group's flow-style declaration untouched", () => {
		const src = `---
group:
  g1: { label: "Layer 1" }
  g2: { label: "Layer 2" }
artifact:
  a: { group: g2 }
---
a
`;
		const { output, members, children } = renameGroup(src, "g1", "gx");
		expect(members).toEqual([]);
		expect(children).toEqual([]);
		expect(output).toContain('g2: { label: "Layer 2" }');
		expect(output).toContain("a: { group: g2 }");
	});

	it("is a no-op reporting found: false when oldId has no local group: declaration", () => {
		const src = `---
group:
  g1:
    label: "Layer 1"
---
a
`;
		const { output, found, members, children } = renameGroup(
			src,
			"ghost",
			"gx",
		);
		expect(found).toBe(false);
		expect(members).toEqual([]);
		expect(children).toEqual([]);
		expect(output).toBe(src);
	});

	it("is a no-op when the source already carries a parse error", () => {
		const src = `---
group:
  g1: [unterminated
---
a
`;
		const { output, found, diagnostics } = renameGroup(src, "g1", "gx");
		expect(found).toBe(false);
		expect(output).toBe(src);
		expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
	});

	it("preserves a folded (>) scalar's hand-wrapped line breaks elsewhere in the document", () => {
		const src = `---
description: >
  Line one.
  Line two.
group:
  g1:
    label: "Layer 1"
---
a
`;
		const { output } = renameGroup(src, "g1", "gx");
		expect(output).toContain("description: >\n  Line one.\n  Line two.\n");
		expect(output).toContain("gx:");
	});
});
