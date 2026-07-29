import { describe, expect, it } from "vitest";
import { setFrontmatterField } from "./frontmatter-cst.js";

describe("setFrontmatterField", () => {
	it("replaces an existing field's value", () => {
		const src = "---\nartifact:\n  spec:\n    status: todo\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "status", "done");
		expect(out).toContain("status: done");
		expect(out).not.toContain("status: todo");
	});

	// This path slices the yaml text the same way frontmatter.ts did when it
	// left a \r on the last line (#636), but the CST parser absorbs it — so
	// these pass as written. Kept as the guard that says so: the two paths are
	// independent implementations and only one of them was ever broken.
	describe("CRLF and padded fences", () => {
		const crlf = (...lines: string[]) => lines.join("\r\n");

		it("rewrites a last-line field in a CRLF file without carrying a \\r", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    status: todo",
				"---",
				"a >> P -> b",
				"",
			);
			const out = setFrontmatterField(
				src,
				"artifact",
				"spec",
				"status",
				"done",
			);
			expect(out).toContain("status: done");
			expect(out).not.toContain("todo");
		});

		it("finds a node whose value is on the last frontmatter line of a CRLF file", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    label: Spec",
				"---",
				"a >> P -> b",
				"",
			);
			expect(
				setFrontmatterField(src, "artifact", "spec", "label", "Renamed"),
			).toContain("label: Renamed");
		});

		it("returns null for an id the frontmatter does not have, CRLF or not", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    status: todo",
				"---",
				"a >> P -> b",
				"",
			);
			expect(
				setFrontmatterField(src, "artifact", "ghost", "status", "done"),
			).toBeNull();
		});

		it("leaves a sibling field on the last frontmatter line untouched", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    status: todo",
				"    criteria: approved",
				"---",
				"a >> P -> b",
				"",
			);
			const out = setFrontmatterField(
				src,
				"artifact",
				"spec",
				"status",
				"done",
			);
			expect(out).toContain("criteria: approved");
			expect(out).not.toContain('criteria: "approved\r"');
		});

		it("keeps every line CRLF when the source is CRLF", () => {
			const src = crlf(
				"---",
				"artifact:",
				"  spec:",
				"    status: todo",
				"---",
				"a >> P -> b",
				"",
			);
			const out = setFrontmatterField(
				src,
				"artifact",
				"spec",
				"status",
				"done",
			);
			expect(out).not.toBeNull();
			expect((out as string).replace(/\r\n/g, "")).not.toContain("\n");
		});

		it("keeps a LF source on LF", () => {
			const src =
				"---\nartifact:\n  spec:\n    status: todo\n---\na >> P -> b\n";
			const out = setFrontmatterField(
				src,
				"artifact",
				"spec",
				"status",
				"done",
			);
			expect(out).not.toContain("\r");
		});
	});

	it("inserts a field that is not yet present", () => {
		const src = "---\nartifact:\n  spec:\n    label: Spec\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "owner", "alice");
		expect(out).toContain("owner: alice");
		expect(out).toContain("label: Spec");
	});

	it("returns null when the id has no frontmatter entry under the given kind", () => {
		const src = "---\nartifact:\n  spec:\n    label: Spec\n---\na >> P -> b\n";
		expect(
			setFrontmatterField(src, "process", "spec", "label", "x"),
		).toBeNull();
		expect(
			setFrontmatterField(src, "artifact", "ghost", "label", "x"),
		).toBeNull();
	});

	it("returns null when there is no frontmatter", () => {
		expect(
			setFrontmatterField("a >> P -> b\n", "artifact", "a", "label", "x"),
		).toBeNull();
	});

	it("writes into a flow-style entry", () => {
		const src =
			"---\nprocess:\n  design: { label: Design }\n---\na >> P -> b\n";
		const out = setFrontmatterField(
			src,
			"process",
			"design",
			"owner",
			"a} b, c",
		);
		expect(out).toContain('owner: "a} b, c"');
	});

	it("writes a numeric value bare (index)", () => {
		const src = "---\nartifact:\n  spec:\n    label: Spec\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "index", 5);
		expect(out).toContain("index: 5");
		expect(out).not.toContain('index: "5"');
	});

	it("handles ids containing regex metacharacters", () => {
		const src =
			"---\nartifact:\n  req(v2):\n    status: todo\n---\na >> P -> b\n";
		const out = setFrontmatterField(
			src,
			"artifact",
			"req(v2)",
			"status",
			"done",
		);
		expect(out).toContain("req(v2):\n    status: done");
	});
});
