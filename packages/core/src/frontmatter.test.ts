import { describe, expect, it } from "vitest";
import { findFrontmatterNodeRanges, loadFrontmatter } from "./frontmatter.js";

describe("loadFrontmatter", () => {
	it("no frontmatter: returns body as-is, bodyStartLine=1", () => {
		const result = loadFrontmatter("A >> P -> B\n");
		expect(result.frontmatter).toBeNull();
		expect(result.body).toBe("A >> P -> B\n");
		expect(result.bodyStartLine).toBe(1);
		expect(result.diagnostics).toHaveLength(0);
	});

	// A CRLF file's last frontmatter line used to keep its \r, because the
	// slice dropped exactly one character before the closing fence (#636). The
	// value silently gained a \r, so a last-line `status: done` failed V007.
	describe("CRLF and padded fences", () => {
		const crlf = (...lines: string[]) => lines.join("\r\n");

		it("does not leave a \\r on the value of the last frontmatter line", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    criteria: approved",
				"---",
				"req >> design -> spec",
				"",
			);
			const result = loadFrontmatter(src);
			expect(result.frontmatter).toEqual({
				artifact: { spec: { criteria: "approved" } },
			});
		});

		it("keeps a last-line status usable, so a CRLF file is not rejected", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    status: done",
				"---",
				"req >> design -> spec",
				"",
			);
			const fm = loadFrontmatter(src).frontmatter as {
				artifact: { spec: { status: string } };
			};
			expect(fm.artifact.spec.status).toBe("done");
		});

		it("reads a CRLF file with several frontmatter lines the same as LF", () => {
			const lines = [
				"---",
				"title: Test",
				"artifact:",
				"  spec:",
				"    label: Spec",
				"---",
				"req >> design -> spec",
				"",
			];
			expect(loadFrontmatter(lines.join("\r\n")).frontmatter).toEqual(
				loadFrontmatter(lines.join("\n")).frontmatter,
			);
		});

		it("accepts a closing fence with trailing spaces", () => {
			const src =
				"---\nartifact:\n  spec:\n    label: Spec\n---   \nreq >> design -> spec\n";
			const result = loadFrontmatter(src);
			expect(result.diagnostics).toHaveLength(0);
			expect(result.frontmatter).toEqual({
				artifact: { spec: { label: "Spec" } },
			});
		});

		it("accepts a CRLF closing fence, which carries a \\r of its own", () => {
			const src = crlf(
				"---",
				"title: Test",
				"---",
				"req >> design -> spec",
				"",
			);
			expect(loadFrontmatter(src).diagnostics).toHaveLength(0);
		});
	});

	it("valid frontmatter: parses YAML and extracts body", () => {
		const src = "---\ntitle: Test\n---\nA >> P\n";
		const result = loadFrontmatter(src);
		expect(result.frontmatter).toEqual({ title: "Test" });
		expect(result.body).toBe("A >> P\n");
		expect(result.bodyStartLine).toBe(4);
		expect(result.diagnostics).toHaveLength(0);
	});

	it("empty frontmatter block: returns null frontmatter", () => {
		const src = "---\n---\nA >> P\n";
		const result = loadFrontmatter(src);
		expect(result.frontmatter).toBeNull();
		expect(result.body).toBe("A >> P\n");
		expect(result.bodyStartLine).toBe(3);
	});

	it("invalid YAML: returns error diagnostic and null frontmatter", () => {
		const src = "---\n: bad: yaml\n---\nbody\n";
		const result = loadFrontmatter(src);
		expect(result.frontmatter).toBeNull();
		expect(
			result.diagnostics.some(
				(d) => d.severity === "error" && d.code === "FM002",
			),
		).toBe(true);
	});

	it("unclosed frontmatter: returns error and treats whole source as body", () => {
		const src = "---\ntitle: Test\n";
		const result = loadFrontmatter(src);
		expect(result.frontmatter).toBeNull();
		expect(result.diagnostics.some((d) => d.code === "FM001")).toBe(true);
	});

	it("bodyStartLine accounts for frontmatter line count", () => {
		const src = "---\na: 1\nb: 2\n---\nbody";
		const result = loadFrontmatter(src);
		expect(result.bodyStartLine).toBe(5);
	});

	it("parses status, tags, statusStyles, tag", () => {
		const src = [
			"---",
			"artifact:",
			"  spec:",
			"    status: done",
			"    tags: [external, critical]",
			"statusStyles:",
			"  done: { fillcolor: lightgray, style: filled }",
			"tag:",
			"  external: { label: 外部公開, style: { color: blue } }",
			'  critical: { style: { penwidth: "3" } }',
			"---",
			"spec >> P -> X",
			"",
		].join("\n");
		const result = loadFrontmatter(src);
		expect(result.diagnostics).toHaveLength(0);
		const fm = result.frontmatter!;
		expect(fm.artifact?.spec?.status).toBe("done");
		expect(fm.artifact?.spec?.tags).toEqual(["external", "critical"]);
		expect(fm.statusStyles?.done?.fillcolor).toBe("lightgray");
		expect(fm.tag?.external?.label).toBe("外部公開");
		expect(fm.tag?.external?.style?.color).toBe("blue");
		expect(fm.tag?.critical?.style?.penwidth).toBe("3");
	});
});

describe("findFrontmatterNodeRanges", () => {
	it("locates node id ranges at 2-space indent (canonical style)", () => {
		const src = [
			"---",
			"artifact:",
			"  spec:",
			"    status: done",
			"---",
			"spec >> P -> X",
			"",
		].join("\n");
		const ranges = findFrontmatterNodeRanges(src);
		expect(ranges.get("spec")).toEqual({
			start: { line: 3, column: 3, offset: 0 },
			end: { line: 3, column: 7, offset: 0 },
		});
	});

	it("locates node id ranges at 4-space indent (#430)", () => {
		const src = [
			"---",
			"artifact:",
			"    spec:",
			"        status: done",
			"---",
			"spec >> P -> X",
			"",
		].join("\n");
		const ranges = findFrontmatterNodeRanges(src);
		expect(ranges.get("spec")).toEqual({
			start: { line: 3, column: 5, offset: 0 },
			end: { line: 3, column: 9, offset: 0 },
		});
	});

	it("detects indent independently per section (#430)", () => {
		const src = [
			"---",
			"artifact:",
			"    spec:",
			"        status: done",
			"process:",
			"  build:",
			"    status: wip",
			"---",
			"spec >> build -> out",
			"",
		].join("\n");
		const ranges = findFrontmatterNodeRanges(src);
		expect(ranges.get("spec")).toEqual({
			start: { line: 3, column: 5, offset: 0 },
			end: { line: 3, column: 9, offset: 0 },
		});
		expect(ranges.get("build")).toEqual({
			start: { line: 6, column: 3, offset: 0 },
			end: { line: 6, column: 8, offset: 0 },
		});
	});
});
