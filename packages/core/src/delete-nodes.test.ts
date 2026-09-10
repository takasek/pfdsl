import { describe, expect, it } from "vitest";
import { deleteNodes } from "./delete-nodes.js";

describe("deleteNodes", () => {
	describe("frontmatter declarations", () => {
		it("removes a single artifact's declaration block", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
---
a; b
`;
			const { output, deleted, notFound } = deleteNodes(src, ["a"]);
			expect(deleted).toEqual(["a"]);
			expect(notFound).toEqual([]);
			expect(output).toContain("b:\n    label: B");
			expect(output).not.toContain("a:\n    label: A");
		});

		it("leaves an empty mapping in place rather than deleting the section key, when the last entry goes", () => {
			// Decision: removing the section key entirely would strip a schema
			// element (`artifact:` as "no artifacts declared yet" vs. absent
			// entirely) for no benefit over the yaml package's own default
			// deleteIn behavior, which already leaves `artifact: {}`.
			const src = `---
artifact:
  a:
    label: A
process:
  p:
    label: P
---
a >> p
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("artifact: {}");
		});

		it("reports an id absent from the document as notFound, not deleted", () => {
			const src = `---
artifact:
  a:
    label: A
---
a
`;
			const { deleted, notFound } = deleteNodes(src, ["ghost"]);
			expect(deleted).toEqual([]);
			expect(notFound).toEqual(["ghost"]);
		});

		it("is idempotent: deleting an already-deleted id is a no-op", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
---
a; b
`;
			const first = deleteNodes(src, ["a"]);
			const second = deleteNodes(first.output, ["a"]);
			expect(second.deleted).toEqual([]);
			expect(second.notFound).toEqual(["a"]);
			expect(second.output).toBe(first.output);
		});
	});

	describe("body edges", () => {
		it("trims a deleted id out of an artifact set, keeping the edge", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
  c:
    label: C
process:
  p:
    label: P
---
[a, b] >> p -> c
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("[b] >> p -> c");
		});

		it("drops the whole input-edge statement when the artifact set empties out", () => {
			const src = `---
artifact:
  a:
    label: A
process:
  p:
    label: P
  q:
    label: Q
---
a >> p

toolchain >> q
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).not.toContain("a >> p");
			expect(output).toContain("toolchain >> q");
			// no doubled blank line left behind where the dropped statement was
			expect(output).not.toMatch(/\n\n\n/);
		});

		it("drops the whole output-edge statement when the process is deleted", () => {
			const src = `---
artifact:
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
p -> b

toolchain >> q
`;
			const { output } = deleteNodes(src, ["p"]);
			expect(output).not.toContain("p -> b");
			expect(output).toContain("toolchain >> q");
		});

		it("drops the whole edge statement when the output artifact is deleted", () => {
			const src = `---
artifact:
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
p -> b

toolchain >> q
`;
			const { output } = deleteNodes(src, ["b"]);
			expect(output).not.toContain("p -> b");
			expect(output).toContain("toolchain >> q");
		});

		it("removes the last statement cleanly, leaving a single trailing newline", () => {
			const src = `---
artifact:
  x:
    label: X
  y:
    label: Y
process:
  p:
    label: P
  q:
    label: Q
---
toolchain >> q

p -> x
`;
			const { output } = deleteNodes(src, ["x"]);
			expect(output.endsWith("toolchain >> q\n")).toBe(true);
			expect(output).not.toMatch(/\n\n\n/);
		});

		it("drops a bare node-decl statement for a deleted id", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
---
a; b
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).not.toMatch(/\ba\b/);
			expect(output).toContain("b");
		});

		it("leaves an untouched statement byte-for-byte unchanged", () => {
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
[a,   b] >> p
`;
			const { output } = deleteNodes(src, ["ghost"]);
			expect(output).toContain("[a,   b] >> p");
		});
	});
});
