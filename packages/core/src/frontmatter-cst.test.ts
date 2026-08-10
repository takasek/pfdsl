import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { loadFrontmatter } from "./frontmatter.js";
import {
	parseFrontmatterCst,
	renderFrontmatterCst,
	setFrontmatterField,
} from "./frontmatter-cst.js";

describe("parseFrontmatterCst yamlText", () => {
	it("captures the raw yaml text between the fences", () => {
		const src = "---\nartifact:\n  spec:\n    status: todo\n---\na >> P -> b\n";
		const cst = parseFrontmatterCst(src);
		expect(cst.yamlText).toBe("artifact:\n  spec:\n    status: todo");
	});

	it("is empty when there is no frontmatter", () => {
		const cst = parseFrontmatterCst("a >> P -> b\n");
		expect(cst.yamlText).toBe("");
	});
});

// The `yaml` package's `Document#toString({ lineWidth: 0 })` re-serializes
// every BLOCK_FOLDED (`>`) scalar onto a single continuation line, discarding
// any line wraps the author put in by hand. `renderFrontmatterCst`'s
// optional third argument re-splices the author's original wraps back into
// the rendered folded scalars — reindented onto the render's own (canonical)
// indentation — as long as the scalar's decoded value is unchanged (#815).
describe("renderFrontmatterCst: preserves folded scalar (>) line wraps (#815)", () => {
	/**
	 * Parse `yamlText`, apply `mutate` to the resulting doc, then render with
	 * fold-preservation against the original text. Strips the `---` fences
	 * `renderFrontmatterCst` always adds, so callers can assert on the yaml
	 * content alone.
	 */
	function renderMutated(
		yamlText: string,
		mutate: (doc: ReturnType<typeof parseDocument>) => void,
	): string {
		const doc = parseDocument(yamlText);
		mutate(doc);
		const block = renderFrontmatterCst(doc, "\n", yamlText);
		return block.slice(4, -4);
	}

	it("keeps a hand-wrapped >, folded scalar's line breaks when a sibling field changes", () => {
		const src = `artifact:
  a:
    description: >
      Hello
      world.
    status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "status"], "done"),
		);
		expect(out).toBe(`artifact:
  a:
    description: >
      Hello
      world.
    status: done
`);
	});

	it("preserves the >- strip chomping indicator alongside the wraps", () => {
		const src = `artifact:
  a:
    description: >-
      Hello
      world.

    status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "status"], "done"),
		);
		expect(out).toBe(`artifact:
  a:
    description: >-
      Hello
      world.

    status: done
`);
	});

	it("preserves the >+ keep chomping indicator alongside the wraps", () => {
		const src = `artifact:
  a:
    description: >+
      Hello
      world.

    status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "status"], "done"),
		);
		expect(out).toBe(`artifact:
  a:
    description: >+
      Hello
      world.

    status: done
`);
	});

	it("preserves a more-indented (hanging) line and blank lines inside the fold", () => {
		const src = `artifact:
  a:
    description: >
      Para one.

        more indented line.

      Para two.
    status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "status"], "done"),
		);
		expect(out).toBe(`artifact:
  a:
    description: >
      Para one.

        more indented line.

      Para two.
    status: done
`);
	});

	it("preserves multiple folded fields in the same file independently", () => {
		const src = `artifact:
  a:
    description: >
      Hello
      world.
  b:
    description: >
      Second
      one.
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "label"], "A"),
		);
		expect(out).toBe(`artifact:
  a:
    description: >
      Hello
      world.
    label: A
  b:
    description: >
      Second
      one.
`);
	});

	it("preserves wraps on an anchored folded scalar", () => {
		const src = `artifact:
  a:
    description: &anc >
      Hello
      world.
    status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "status"], "done"),
		);
		expect(out).toBe(`artifact:
  a:
    description: &anc >
      Hello
      world.
    status: done
`);
	});

	it("preserves wraps on a folded scalar reached through a nested path", () => {
		const src = `artifact:
  a:
    b:
      description: >
        Hello
        world.
      status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "b", "status"], "done"),
		);
		expect(out).toBe(`artifact:
  a:
    b:
      description: >
        Hello
        world.
      status: done
`);
	});

	it("canonicalizes 8-space continuation indentation to the render's 2-space indent, keeping the wraps", () => {
		const src = `artifact:
  a:
    description: >
        Hello
        world.
    status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "status"], "done"),
		);
		expect(out).toBe(`artifact:
  a:
    description: >
      Hello
      world.
    status: done
`);
	});

	it("does not preserve wraps when the scalar has an explicit indentation indicator (>2)", () => {
		const src = `artifact:
  a:
    description: >2
      Hello
      world.
    status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "status"], "done"),
		);
		expect(out).toBe(`artifact:
  a:
    description: >
      Hello world.
    status: done
`);
	});

	it("re-serializes (does not preserve) a folded field whose own value was rewritten", () => {
		const src = `artifact:
  a:
    description: >
      Hello
      world.
    status: todo
`;
		const out = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "description"], "changed value"),
		);
		expect(out).toBe(`artifact:
  a:
    description: >-
      changed value
    status: todo
`);
	});

	it("leaves output unchanged when there are no folded scalars (no regression)", () => {
		const src = `artifact:
  a:
    label: A
`;
		const withFold = renderMutated(src, (doc) =>
			doc.setIn(["artifact", "a", "label"], "B"),
		);
		const withoutFold = (() => {
			const doc = parseDocument(src);
			doc.setIn(["artifact", "a", "label"], "B");
			return renderFrontmatterCst(doc, "\n").slice(4, -4);
		})();
		expect(withFold).toBe(withoutFold);
	});
});

describe("setFrontmatterField", () => {
	it("replaces an existing field's value", () => {
		const src = "---\nartifact:\n  spec:\n    status: todo\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "status", "done");
		expect(out).toContain("status: done");
		expect(out).not.toContain("status: todo");
	});

	// This path slices the yaml text the same way frontmatter.ts did when it
	// left a \r on the last line (#636). The first three cases pass even
	// before that slice is corrected, because they only look at the field
	// being rewritten — which is what let the same bug live on here (#644).
	// The cases after them look at the sibling field and at the line endings,
	// where the two paths actually differed.
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

		// frontmatter.ts (read) and frontmatter-cst.ts (write) are deliberately
		// independent implementations of the same fence math, and the \r bug
		// was fixed in each of them separately, one release apart (#636, then
		// #644). This pins the two to the same reading of the same bytes so a
		// third divergence shows up as a failure rather than as a stained file.
		it("reads the same values as the read path for the same CRLF source", () => {
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
			expect(parseFrontmatterCst(src).doc.toJSON()).toEqual(
				loadFrontmatter(src).frontmatter,
			);
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

	// Document#toString({ lineWidth: 0 }) would otherwise collapse a folded
	// (`>`) scalar's hand-chosen line wraps onto one continuation line (#815).
	it("preserves a folded scalar's hand-wrapped line breaks on a sibling field", () => {
		const src =
			"---\nartifact:\n  a:\n    description: >\n      Hello\n      world.\n    status: todo\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "a", "status", "done");
		expect(out).toContain("description: >\n      Hello\n      world.\n");
	});
});
