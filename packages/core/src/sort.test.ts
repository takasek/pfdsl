import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
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
		// After sorting: a then b, blank line preserved between them
		expect(output).toContain("\n\n");
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
});
