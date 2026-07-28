import { describe, expect, it } from "vitest";
import { setFrontmatterField } from "./frontmatter-cst.js";

describe("setFrontmatterField", () => {
	it("replaces an existing field's value", () => {
		const src = "---\nartifact:\n  spec:\n    status: todo\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "status", "done");
		expect(out).toContain("status: done");
		expect(out).not.toContain("status: todo");
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
