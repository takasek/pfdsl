import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
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

	// `analyze()`'s plain-object frontmatter always has string keys — JS
	// coerces every object property key to a string, regardless of what
	// scalar type the YAML source had (`42:` bare and unquoted parses to the
	// CST's Scalar as the *number* 42, not the string "42") — so a caller
	// checking "is `oldId` declared?" via that plain object (an own-property
	// read, e.g. Object.hasOwn(frontmatter.group, "42")) sees it declared,
	// and this function must match the same identity or it silently fails to
	// find the pair it was just told exists.
	it("matches a bare, unquoted integer group key by its string form", () => {
		const src = `---
group:
  42:
    label: Num
---
a
`;
		const { output, found, diagnostics } = renameGroup(src, "42", "numbered");
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(found).toBe(true);
		const { frontmatter } = analyze(output);
		expect(Object.hasOwn(frontmatter?.group ?? {}, "numbered")).toBe(true);
		expect(Object.hasOwn(frontmatter?.group ?? {}, "42")).toBe(false);
	});

	it("matches a bare, unquoted integer group key when renaming to another bare integer", () => {
		const src = `---
group:
  42:
    label: Num
---
a
`;
		const { output, found } = renameGroup(src, "42", "43");
		expect(found).toBe(true);
		const { frontmatter } = analyze(output);
		expect(Object.hasOwn(frontmatter?.group ?? {}, "43")).toBe(true);
		expect(Object.hasOwn(frontmatter?.group ?? {}, "42")).toBe(false);
	});

	it("matches a member whose group: field is the same bare, unquoted integer", () => {
		const src = `---
group:
  42:
    label: Num
artifact:
  a:
    group: 42
process:
  p:
    group: 42
---
a >> p -> b
`;
		const { output, members } = renameGroup(src, "42", "numbered");
		expect(members).toEqual(["a", "p"]);
		const { frontmatter } = analyze(output);
		expect(String(frontmatter?.artifact?.a?.group)).toBe("numbered");
		expect(String(frontmatter?.process?.p?.group)).toBe("numbered");
	});

	it("matches another group's parent: field when it is the same bare, unquoted integer", () => {
		const src = `---
group:
  42:
    label: Num
  child:
    label: Child
    parent: 42
---
a
`;
		const { output, children } = renameGroup(src, "42", "numbered");
		expect(children).toEqual(["child"]);
		const { frontmatter } = analyze(output);
		expect(String(frontmatter?.group?.child?.parent)).toBe("numbered");
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
