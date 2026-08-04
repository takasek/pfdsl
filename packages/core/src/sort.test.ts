import { describe, expect, it } from "vitest";
import { analyze, format } from "./index.js";
import { sort } from "./sort.js";

/** Return node IDs in declaration order from the given section of a re-parsed source. */
function nodeOrder(src: string, section: "artifact" | "process"): string[] {
	const { frontmatter } = analyze(src);
	return Object.keys(frontmatter?.[section] ?? {});
}

describe("sort --by id", () => {
	it("sorts artifact nodes alphabetically", () => {
		const src = `---
artifact:
  z: { label: Z }
  a: { label: A }
  m: { label: M }
---
z >> p -> a
m >> p2 -> z
`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(true);
		expect(nodeOrder(output, "artifact")).toEqual(["a", "m", "z"]);
	});

	it("returns changed=false when already sorted", () => {
		const src = `---
artifact:
  a: { label: A }
  m: { label: M }
  z: { label: Z }
---
a >> p -> z
`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(false);
		expect(output).toBe(src);
	});

	it("sorts process nodes independently from artifact nodes", () => {
		const src = `---
artifact:
  c: { label: C }
  b: { label: B }
  a: { label: A }
process:
  q: { label: Q }
  p: { label: P }
---
a >> p -> b
b >> q -> c
`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(true);
		expect(nodeOrder(output, "artifact")).toEqual(["a", "b", "c"]);
		expect(nodeOrder(output, "process")).toEqual(["p", "q"]);
	});
});

describe("sort --by index", () => {
	it("sorts by index ascending, unindexed nodes last (stable)", () => {
		const src = `---
artifact:
  c:
    index: 3
    label: C
  a:
    index: 1
    label: A
  b:
    index: 2
    label: B
  z:
    label: Z (no index)
---
a >> p -> b
b >> p2 -> c
`;
		const { output, changed } = sort(src, { by: ["index"] });
		expect(changed).toBe(true);
		expect(nodeOrder(output, "artifact")).toEqual(["a", "b", "c", "z"]);
	});

	it("stable: preserves original order among unindexed nodes", () => {
		const src = `---
artifact:
  z2:
    label: Z2
  z1:
    label: Z1
  a:
    index: 1
    label: A
---
a >> p -> z1
z2 >> p2 -> a
`;
		const { output } = sort(src, { by: ["index"] });
		expect(nodeOrder(output, "artifact")).toEqual(["a", "z2", "z1"]);
	});

	it("idempotent: re-sorting an already sorted file yields changed=false", () => {
		const src = `---
artifact:
  a:
    index: 1
  b:
    index: 2
  z:
    label: Z (no index)
---
a >> p -> b
`;
		const { output, changed } = sort(src, { by: ["index"] });
		expect(changed).toBe(false);
		expect(output).toBe(src);
	});
});

describe("sort --by topological", () => {
	it("sorts nodes in topological order (source before sink)", () => {
		const src = `---
artifact:
  c:
    label: C (sink)
  a:
    label: A (source)
  b:
    label: B (middle)
process:
  p2:
    label: P2
  p1:
    label: P1
---
a >> p1 -> b
b >> p2 -> c
`;
		const { output, changed } = sort(src, { by: ["topological"] });
		expect(changed).toBe(true);
		// a is source, b is middle, c is sink
		const arts = nodeOrder(output, "artifact");
		expect(arts.indexOf("a")).toBeLessThan(arts.indexOf("b"));
		expect(arts.indexOf("b")).toBeLessThan(arts.indexOf("c"));
		// p1 before p2
		const procs = nodeOrder(output, "process");
		expect(procs.indexOf("p1")).toBeLessThan(procs.indexOf("p2"));
	});
});

describe("sort --by group", () => {
	it("groups nodes by group field, ungrouped last (stable within group)", () => {
		const src = `---
artifact:
  x:
    label: X
    group: beta
  a:
    label: A
    group: alpha
  b:
    label: B
    group: alpha
  y:
    label: Y (no group)
---
a >> p -> b
`;
		const { output, changed } = sort(src, { by: ["group"] });
		expect(changed).toBe(true);
		const arts = nodeOrder(output, "artifact");
		// alpha group first (a then b — original order), then beta (x), then ungrouped (y)
		expect(arts).toEqual(["a", "b", "x", "y"]);
	});
});

describe("sort --by group,index (multi-key)", () => {
	it("primary=group, secondary=index within each group", () => {
		const src = `---
artifact:
  b2:
    label: B2
    group: beta
    index: 2
  a1:
    label: A1
    group: alpha
    index: 1
  b1:
    label: B1
    group: beta
    index: 1
  a2:
    label: A2
    group: alpha
    index: 2
---
a1 >> p -> b1
`;
		const { output, changed } = sort(src, { by: ["group", "index"] });
		expect(changed).toBe(true);
		expect(nodeOrder(output, "artifact")).toEqual(["a1", "a2", "b1", "b2"]);
	});
});

describe("sort: text preservation", () => {
	it("preserves preceding comment lines attached to their node block", () => {
		const src = `---
artifact:
  # comment for b
  b:
    label: B
  # comment for a
  a:
    label: A
---
b >> p -> a
`;
		const { output } = sort(src, { by: ["id"] });
		// a should come before b, with its comment
		const lines = output.split("\n");
		const aIdx = lines.findIndex((l) => l.includes("  a:"));
		const bIdx = lines.findIndex((l) => l.includes("  b:"));
		const aCommentIdx = lines.findIndex((l) => l.includes("# comment for a"));
		const bCommentIdx = lines.findIndex((l) => l.includes("# comment for b"));
		expect(aIdx).toBeLessThan(bIdx);
		// a's comment is directly above a
		expect(aCommentIdx).toBe(aIdx - 1);
		// b's comment is directly above b
		expect(bCommentIdx).toBe(bIdx - 1);
	});

	it("preserves blank line separators between blocks", () => {
		const src = `---
artifact:
  b:
    label: B

  a:
    label: A
---
b >> p -> a
`;
		const { output } = sort(src, { by: ["id"] });
		// After sorting: a then b. The blank line travels with the node that
		// carried it (yaml's `spaceBefore` is a leading-gap flag on the node
		// itself), so it now renders right after the section header, before
		// `a` — a blank (whitespace-only) line rather than the fully-empty
		// "\n\n" the old line-splicing implementation produced.
		expect(output).toMatch(/\n[ \t]*\n/);
		expect(nodeOrder(output, "artifact")).toEqual(["a", "b"]);
	});

	it("preserves child fields in their original order when block moves", () => {
		const src = `---
artifact:
  b:
    label: B
    index: 2
    status: done
  a:
    label: A
    index: 1
    status: todo
---
b >> p -> a
`;
		const { output } = sort(src, { by: ["index"] });
		const { frontmatter } = analyze(output);
		expect(frontmatter?.artifact?.a?.label).toBe("A");
		expect(frontmatter?.artifact?.a?.status).toBe("todo");
		expect(frontmatter?.artifact?.b?.label).toBe("B");
		expect(frontmatter?.artifact?.b?.status).toBe("done");
		expect(nodeOrder(output, "artifact")).toEqual(["a", "b"]);
	});

	it("handles inline mapping nodes", () => {
		const src = `---
artifact:
  b: { label: B, index: 2 }
  a: { label: A, index: 1 }
---
b >> p -> a
`;
		const { output, changed } = sort(src, { by: ["index"] });
		expect(changed).toBe(true);
		expect(nodeOrder(output, "artifact")).toEqual(["a", "b"]);
	});

	it("sorts a whole section written as a single flow-style line, preserving its one-line form", () => {
		const src = `---
artifact: { z: { label: Z, index: 2 }, a: { label: A, index: 1 } }
---
a >> p -> z
`;
		const { output, changed } = sort(src, { by: ["index"] });
		expect(changed).toBe(true);
		expect(nodeOrder(output, "artifact")).toEqual(["a", "z"]);
		// still a single flow-style line, not exploded to block style
		expect(output).toContain(
			"artifact: { a: { label: A, index: 1 }, z: { label: Z, index: 2 } }",
		);
	});

	it("preserves an untouched folded-scalar's line wraps when the section reorders", () => {
		const src = `---
artifact:
  z:
    label: Z
  foo:
    description: >
      long text
      wrapped here
    label: Foo
---
z >> p -> foo
`;
		const { output } = sort(src, { by: ["id"] });
		expect(output).toContain(
			"description: >\n      long text\n      wrapped here\n",
		);
	});

	it("doesn't add a spurious blank line before the closing fence when the last entry in sorted order is flow-valued (#695-fix2)", () => {
		const src = `---
artifact:
  z: { label: Z }
  a: { label: A }
  m: { label: M }
---
z >> p -> a
m >> p2 -> z
`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(true);
		expect(output).toBe(`---
artifact:
  a: { label: A }
  m: { label: M }
  z: { label: Z }
---
z >> p -> a
m >> p2 -> z
`);
	});

	// Mirror of the #695-fix2 case above: there, the entry landing last after
	// reorder was flow-valued (whose own range never carries a trailing
	// newline), and the fix was to skip adding one. Here, the entry landing
	// last is block-valued — its own captured span DOES carry a trailing
	// newline, because it wasn't originally last (block-style value ranges
	// swallow their own trailing newline, per this file's own doc comments).
	// That newline survives into the splice replacement, so when this
	// section is the last thing in the frontmatter, `yamlText` ends up
	// carrying a trailing newline of its own — violating the invariant
	// documented on `FrontmatterCst.yamlText` — and `sort()`'s own template
	// then adds a second one before `---`, producing a spurious blank line
	// (final-review C2).
	it("doesn't add a spurious blank line before the closing fence when the last entry in sorted order is block-valued", () => {
		const src = `---
artifact:
  z:
    label: Z
  a:
    label: A
---
a >> p -> z
`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(true);
		expect(output).toBe(`---
artifact:
  a:
    label: A
  z:
    label: Z
---
a >> p -> z
`);
		// The output must itself already be canonically formatted — otherwise
		// `sort --write` would hand the user a file `fmt --check` rejects.
		expect(format(output, { style: "flows" }).output).toBe(output);
	});

	it("doesn't add a spurious blank line before the closing fence when the last entry in sorted order is block-valued (CRLF)", () => {
		const src = [
			"---",
			"artifact:",
			"  z:",
			"    label: Z",
			"  a:",
			"    label: A",
			"---",
			"a >> p -> z",
			"",
		].join("\r\n");
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(true);
		expect(output).toBe(
			[
				"---",
				"artifact:",
				"  a:",
				"    label: A",
				"  z:",
				"    label: Z",
				"---",
				"a >> p -> z",
				"",
			].join("\r\n"),
		);
	});

	it("preserves the body (non-frontmatter) unchanged", () => {
		const body = "b >> p -> a\na >> p2 -> b\n";
		const src = `---
artifact:
  b: { label: B }
  a: { label: A }
---
${body}`;
		const { output } = sort(src, { by: ["id"] });
		expect(output.endsWith(body)).toBe(true);
	});
});

describe("sort: edge cases", () => {
	it("returns diagnostics and unchanged source on parse error", () => {
		const src = `a >> >> b\n`;
		const { output, changed, diagnostics } = sort(src, { by: ["id"] });
		expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
		expect(changed).toBe(false);
		expect(output).toBe(src);
	});

	it("no-op on source without frontmatter", () => {
		const src = `a >> p -> b\n`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(false);
		expect(output).toBe(src);
	});

	it("no-op when frontmatter has no artifact/process sections", () => {
		const src = `---
title: Test
---
a >> p -> b
`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(false);
		expect(output).toBe(src);
	});

	it("keeps a CRLF source on CRLF (#644)", () => {
		const src = [
			"---",
			"artifact:",
			"  z: { label: Z }",
			"  a: { label: A }",
			"---",
			"a >> p -> z",
			"",
		].join("\r\n");
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(true);
		expect(output.replace(/\r\n/g, "")).not.toContain("\n");
	});

	it("leaves a section with an anchor/alias untouched instead of splicing the alias before its anchor", () => {
		// Sorting by id alphabetically would want `a` before `z`, but `z`
		// defines the anchor that `a`'s value aliases — no reorder mechanism
		// can honor that order without breaking the anchor/alias relationship
		// (an anchor must precede its alias in the serialized stream). This is
		// out of scope for `sort()`: it must leave the section exactly as it
		// found it rather than produce invalid YAML.
		const src = `---
artifact:
  z:
    label: &sharedLabel Z
  a:
    label: *sharedLabel
---
z >> p -> a
`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(false);
		expect(output).toBe(src);
		const { diagnostics, frontmatter } = analyze(output);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(frontmatter?.artifact?.a?.label).toBe("Z");
		expect(frontmatter?.artifact?.z?.label).toBe("Z");
		expect(nodeOrder(output, "artifact")).toEqual(["z", "a"]);
	});

	it("still splices a section with no anchor/alias, even when another section is skipped for having one", () => {
		const src = `---
artifact:
  z:
    label: &sharedLabel Z
  a:
    label: *sharedLabel
process:
  q: { label: Q }
  p: { label: P }
---
z >> p -> a
a >> q -> w
`;
		const { output, changed } = sort(src, { by: ["id"] });
		expect(changed).toBe(true);
		const { diagnostics, frontmatter } = analyze(output);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(frontmatter?.artifact?.a?.label).toBe("Z");
		// artifact has an anchor/alias, so it's left untouched...
		expect(nodeOrder(output, "artifact")).toEqual(["z", "a"]);
		// ...but process has none, so it's still spliced into sorted order.
		expect(nodeOrder(output, "process")).toEqual(["p", "q"]);
	});
});
