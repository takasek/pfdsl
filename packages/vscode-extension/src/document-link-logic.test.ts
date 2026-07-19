import { describe, expect, it } from "vitest";
import { extractDocumentLinks } from "./document-link-logic.js";

const DOC_PATH = "/repo/.pfdsl/roadmap.pfdsl";

const MINIMAL_PFDSL = `---
artifact:
  spec:
    location: ../docs/spec.md
  published:
    location: https://github.com/takasek/pfdsl/issues/1
process:
  build:
    subflow: sub.pfdsl
---

spec >> build -> published
`;

describe("extractDocumentLinks", () => {
	it("returns a link for a relative location field", () => {
		const links = extractDocumentLinks(MINIMAL_PFDSL, DOC_PATH);
		const specLink = links.find((l) => l.target.includes("/repo/docs/spec.md"));
		expect(specLink).toBeDefined();
		expect(specLink?.target).toBe("file:///repo/docs/spec.md");
	});

	it("returns a link for a URL location field", () => {
		const links = extractDocumentLinks(MINIMAL_PFDSL, DOC_PATH);
		const urlLink = links.find((l) =>
			l.target.startsWith("https://github.com"),
		);
		expect(urlLink).toBeDefined();
		expect(urlLink?.target).toBe("https://github.com/takasek/pfdsl/issues/1");
	});

	it("returns a link for a subflow field", () => {
		const links = extractDocumentLinks(MINIMAL_PFDSL, DOC_PATH);
		const subflowLink = links.find((l) => l.target.includes("sub.pfdsl"));
		expect(subflowLink).toBeDefined();
		expect(subflowLink?.target).toBe("file:///repo/.pfdsl/sub.pfdsl");
	});

	it("does not produce links for body lines", () => {
		const links = extractDocumentLinks(MINIMAL_PFDSL, DOC_PATH);
		// All links should be within the frontmatter section
		const bodyStart = MINIMAL_PFDSL.split("\n").findIndex(
			(l, i) => i > 0 && l === "---",
		);
		for (const link of links) {
			expect(link.line).toBeLessThan(bodyStart);
		}
	});

	it("returns empty array when there is no frontmatter", () => {
		const src = "spec >> build -> published\n";
		expect(extractDocumentLinks(src, DOC_PATH)).toEqual([]);
	});

	it("sets correct column range for the value", () => {
		const src = `---\nartifact:\n  a:\n    location: docs/foo.md\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links).toHaveLength(1);
		const link = links[0]!;
		// "    location: " is 14 chars, no quote
		expect(link.startChar).toBe(14);
		expect(link.endChar).toBe(14 + "docs/foo.md".length);
	});

	it("handles quoted location values", () => {
		const src = `---\nartifact:\n  a:\n    location: "docs/foo.md"\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links).toHaveLength(1);
		const link = links[0]!;
		// "    location: \"" is 15 chars (prefix 14 + quote 1)
		expect(link.startChar).toBe(15);
		expect(link.endChar).toBe(15 + "docs/foo.md".length);
	});

	it("resolves location relative to basePath when basePath is specified", () => {
		const src = `---\nbasePath: ../\nartifact:\n  a:\n    location: config.json\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links).toHaveLength(1);
		// DOC_PATH is /repo/.pfdsl/roadmap.pfdsl; basePath ../ → /repo/; config.json → /repo/config.json
		expect(links[0]?.target).toBe("file:///repo/config.json");
	});

	it("does not apply basePath to subflow: links (always relative to the .pfdsl file's directory)", () => {
		const src = `---\nbasePath: ../\nprocess:\n  build:\n    subflow: sub.pfdsl\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links).toHaveLength(1);
		// DOC_PATH is /repo/.pfdsl/roadmap.pfdsl; subflow ignores basePath → /repo/.pfdsl/sub.pfdsl
		expect(links[0]?.target).toBe("file:///repo/.pfdsl/sub.pfdsl");
	});

	it("returns a link for each item in a block (dash) array location", () => {
		const src = `---\nartifact:\n  a:\n    location:\n      - src/foo.ts\n      - src/bar.ts\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links.map((l) => l.target)).toEqual([
			"file:///repo/.pfdsl/src/foo.ts",
			"file:///repo/.pfdsl/src/bar.ts",
		]);
	});

	it("sets column range for each block array item to the item text only", () => {
		const src = `---\nartifact:\n  a:\n    location:\n      - src/foo.ts\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links).toHaveLength(1);
		const link = links[0]!;
		expect(link.line).toBe(4);
		// "      - " is 8 chars
		expect(link.startChar).toBe(8);
		expect(link.endChar).toBe(8 + "src/foo.ts".length);
	});

	it("returns a link for each item in a single-line flow array location", () => {
		const src = `---\nartifact:\n  a:\n    location: [src/foo.ts, src/bar.ts]\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links.map((l) => l.target)).toEqual([
			"file:///repo/.pfdsl/src/foo.ts",
			"file:///repo/.pfdsl/src/bar.ts",
		]);
	});

	it("returns a link for each item in a multi-line flow array location", () => {
		const src = `---\nartifact:\n  a:\n    location:\n      [\n        src/foo.ts,\n        src/bar.ts,\n      ]\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links.map((l) => l.target)).toEqual([
			"file:///repo/.pfdsl/src/foo.ts",
			"file:///repo/.pfdsl/src/bar.ts",
		]);
	});

	it("still links a scalar location field", () => {
		const src = `---\nartifact:\n  a:\n    location: src/foo.ts\n---\n`;
		const links = extractDocumentLinks(src, DOC_PATH);
		expect(links).toHaveLength(1);
		expect(links[0]?.target).toBe("file:///repo/.pfdsl/src/foo.ts");
	});
});
