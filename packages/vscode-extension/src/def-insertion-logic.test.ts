import { analyze, type NodeKind } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import { findUndefinedNodeKind } from "./def-insertion-logic.js";

function analyzeFor(src: string): {
	nodeKinds: Map<string, NodeKind>;
	frontmatter: ReturnType<typeof analyze>["frontmatter"];
} {
	const { nodeKinds, frontmatter } = analyze(src);
	return { nodeKinds, frontmatter };
}

describe("findUndefinedNodeKind", () => {
	it("returns the kind for a node that only appears in edges", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { nodeKinds, frontmatter } = analyzeFor(src);
		expect(findUndefinedNodeKind(nodeKinds, frontmatter, "p")).toBe("process");
		expect(findUndefinedNodeKind(nodeKinds, frontmatter, "b")).toBe("artifact");
	});

	it("returns undefined for a node that already has a frontmatter definition", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { nodeKinds, frontmatter } = analyzeFor(src);
		expect(findUndefinedNodeKind(nodeKinds, frontmatter, "a")).toBeUndefined();
	});

	it("returns undefined for an id that isn't a node at all", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { nodeKinds, frontmatter } = analyzeFor(src);
		expect(
			findUndefinedNodeKind(nodeKinds, frontmatter, "nope"),
		).toBeUndefined();
	});
});
