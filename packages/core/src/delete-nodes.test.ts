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
	});
});
