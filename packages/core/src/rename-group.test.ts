import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { rename } from "./rename.js";

/** `rename`'s result for a group id it is expected to rename. */
function renamed(source: string, oldId: string, newId: string) {
	const r = rename(source, oldId, newId);
	if (!r.ok || r.kind !== "group") {
		throw new Error(`expected a group rename, got ${JSON.stringify(r)}`);
	}
	return r;
}

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
		const { output } = renamed(src, "g1", "gx");
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
		const { output, children } = renamed(src, "g1", "gx");
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
		const { output, members } = renamed(src, "g1", "gx");
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
		const { output, members, children } = renamed(src, "g1", "gx");
		expect(members).toEqual([]);
		expect(children).toEqual([]);
		expect(output).toContain('g2: { label: "Layer 2" }');
		expect(output).toContain("a: { group: g2 }");
	});

	// A group id that looks numeric must be written as a YAML string wherever
	// it lands (spec: declaration ids and group:/parent: references are
	// strings; a bare `43` would re-read as a number and fail with FM004).
	it("writes a numeric-looking new id quoted in the key, parent: and group: positions", () => {
		const src = `---
group:
  "42":
    label: Num
  child:
    label: Child
    parent: "42"
artifact:
  a:
    group: "42"
process:
  p:
    group: "42"
---
a >> p -> b
`;
		const { output, members, children } = renamed(src, "42", "43");
		expect(members).toEqual(["a", "p"]);
		expect(children).toEqual(["child"]);
		expect(output).toBe(`---
group:
  "43":
    label: Num
  child:
    label: Child
    parent: "43"
artifact:
  a:
    group: "43"
process:
  p:
    group: "43"
---
a >> p -> b
`);
		const after = analyze(output);
		expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(Object.keys(after.frontmatter?.group ?? {})).toEqual([
			"43",
			"child",
		]);
	});

	// Only a document that could not be read (FM / L / P) blocks the rewrite.
	// A validation (V) or normalizer (N) error is judged on the result by the
	// caller, the same way `meta set` judges its write.
	it("still renames when the source carries a validation (V) error", () => {
		const src = `---
group:
  g1:
    label: G1
artifact:
  a: { status: bogus, group: g1 }
---
a >> p -> b
`;
		const { output, members } = renamed(src, "g1", "gx");
		expect(members).toEqual(["a"]);
		expect(output).toBe(`---
group:
  gx:
    label: G1
artifact:
  a: { status: bogus, group: gx }
---
a >> p -> b
`);
	});

	it("still renames when the source carries a normalizer (N) error", () => {
		const src = `---
group:
  g1:
    label: G1
artifact:
  x: {label: X}
process:
  x: {label: X}
---
a >> p -> b
`;
		const { output } = renamed(src, "g1", "gx");
		expect(output).toContain("  gx:\n    label: G1\n");
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
		const { output } = renamed(src, "g1", "gx");
		expect(output).toContain("description: >\n  Line one.\n  Line two.\n");
		expect(output).toContain("gx:");
	});
});

// The id-identity defects found in review (#1218: a prototype-member name,
// a numeric-looking key) were each one shape of the same question — does the
// group id the caller names match the id every representation of the file
// holds? This checks that question across the product of the ways a string
// id can be written, the places it is referenced, and the YAML styles,
// against the invariant from spec §2.8 rather than against the
// implementation: after the rename, re-reading the file finds <new> wherever
// <old> was and <old> nowhere, and leaves every other reference alone.
describe("renameGroup id identity across key shapes, positions and styles", () => {
	const oldTokens = ["g1", '"g1"', "'g1'", "toString", '"42"'];
	const newIds = ["gx", "43", "true", "null", "1e3", "constructor"];
	const styles = ["flow", "block"] as const;

	const unquote = (token: string): string => token.replace(/^["']|["']$/g, "");

	const render = (token: string, style: (typeof styles)[number]): string =>
		style === "flow"
			? `---
group:
  ${token}: { label: Old }
  child: { label: Child, parent: ${token} }
  other: { label: Other }
artifact:
  a: { status: done, criteria: x, group: ${token} }
  b: { status: todo, criteria: y, group: other }
process:
  p: { group: ${token} }
---
a >> p -> b
`
			: `---
group:
  ${token}:
    label: Old
  child:
    label: Child
    parent: ${token}
  other:
    label: Other
artifact:
  a:
    status: done
    criteria: x
    group: ${token}
  b:
    status: todo
    criteria: y
    group: other
process:
  p:
    group: ${token}
---
a >> p -> b
`;

	const cases = oldTokens.flatMap((token) =>
		newIds.flatMap((newId) => styles.map((style) => ({ token, newId, style }))),
	);

	it.each(cases)("renames $token -> $newId ($style)", ({
		token,
		newId,
		style,
	}) => {
		const oldId = unquote(token);
		const { output } = renamed(render(token, style), oldId, newId);
		const { frontmatter, diagnostics } = analyze(output);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		const groups = frontmatter?.group ?? {};
		expect(Object.hasOwn(groups, newId)).toBe(true);
		expect(Object.hasOwn(groups, oldId)).toBe(false);
		expect(Object.keys(groups)).toEqual([newId, "child", "other"]);
		expect(groups.child?.parent).toBe(newId);
		expect(frontmatter?.artifact?.a?.group).toBe(newId);
		expect(frontmatter?.process?.p?.group).toBe(newId);
		expect(frontmatter?.artifact?.b?.group).toBe("other");
	});
});
