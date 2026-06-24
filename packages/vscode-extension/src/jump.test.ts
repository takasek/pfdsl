import { describe, expect, it } from "vitest";
import { findFrontmatterDefinitionInText } from "./jump-logic.js";

const FM_SOURCE = `---
artifact:
  spec_doc: {}
  result: {}
process:
  build: {}
---
spec_doc >> build -> result
`;

describe("findFrontmatterDefinitionInText", () => {
	it("finds an artifact id in the frontmatter", () => {
		const pos = findFrontmatterDefinitionInText(FM_SOURCE, "spec_doc");
		expect(pos).toBeDefined();
		expect(pos?.line).toBe(2);
		expect(pos?.column).toBe(2);
	});

	it("finds a process id in the frontmatter", () => {
		const pos = findFrontmatterDefinitionInText(FM_SOURCE, "build");
		expect(pos).toBeDefined();
		expect(pos?.line).toBe(5);
	});

	it("returns undefined for an id not in frontmatter", () => {
		const pos = findFrontmatterDefinitionInText(FM_SOURCE, "unknown");
		expect(pos).toBeUndefined();
	});

	it("returns undefined when there is no frontmatter", () => {
		const pos = findFrontmatterDefinitionInText("A >> P -> B\n", "A");
		expect(pos).toBeUndefined();
	});

	it("does not match body lines below frontmatter", () => {
		const src = `---
artifact:
  spec: {}
---
spec >> P
`;
		const pos = findFrontmatterDefinitionInText(src, "spec");
		expect(pos?.line).toBe(2);
	});

	it("returns column accounting for indentation", () => {
		const src = `---\nartifact:\n    deep_id: {}\n---\n`;
		const pos = findFrontmatterDefinitionInText(src, "deep_id");
		expect(pos?.column).toBe(4);
	});
});
