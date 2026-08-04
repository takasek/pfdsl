import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { loadFrontmatter } from "./frontmatter.js";
import {
	newEntrySplice,
	parseFrontmatterCst,
	setFrontmatterField,
} from "./frontmatter-cst.js";

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

	// Inserting into an empty flow map (`spec: {}`) has no existing sibling
	// text to lean on for the closing brace's leading space, unlike the
	// non-empty case above — the splice has to supply both delimiters
	// itself. It was only supplying the leading one, producing `{ index: 1}`.
	it("adds a trailing space when splicing a field into an empty flow map", () => {
		const src = "---\nartifact:\n  spec: {}\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "index", 1);
		expect(out).toBe(
			"---\nartifact:\n  spec: { index: 1 }\n---\na >> P -> b\n",
		);
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

	it("preserves an untouched folded-scalar sibling's line wraps (#issue)", () => {
		const src = [
			"---",
			"artifact:",
			"  foo:",
			"    label: Foo",
			"    description: >",
			"      This is a long description",
			"      that spans multiple lines",
			"      intentionally folded.",
			"    status: todo",
			"---",
			"body",
			"",
		].join("\n");
		const out = setFrontmatterField(src, "artifact", "foo", "status", "wip");
		expect(out).toBe(
			[
				"---",
				"artifact:",
				"  foo:",
				"    label: Foo",
				"    description: >",
				"      This is a long description",
				"      that spans multiple lines",
				"      intentionally folded.",
				"    status: wip",
				"---",
				"body",
				"",
			].join("\n"),
		);
	});

	it("inserts a missing field mid-document without duplicating the next section's newline", () => {
		const src =
			"---\nartifact:\n  spec:\n    label: Spec\nprocess:\n  p:\n    label: P\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "owner", "alice");
		expect(out).toBe(
			"---\nartifact:\n  spec:\n    label: Spec\n    owner: alice\nprocess:\n  p:\n    label: P\n---\na >> P -> b\n",
		);
	});

	it("inserts a missing field under CRLF without mixing line endings", () => {
		const crlf = (...lines: string[]) => lines.join("\r\n");
		const src = crlf(
			"---",
			"artifact:",
			"  spec:",
			"    label: Spec",
			"---",
			"a >> P -> b",
			"",
		);
		const out = setFrontmatterField(src, "artifact", "spec", "owner", "alice");
		expect(out).toBe(
			crlf(
				"---",
				"artifact:",
				"  spec:",
				"    label: Spec",
				"    owner: alice",
				"---",
				"a >> P -> b",
				"",
			),
		);
	});

	it("falls back to full re-serialization for a field that is an alias reference", () => {
		const src =
			"---\ndefaults: &d\n  owner: alice\nartifact:\n  spec:\n    label: Spec\n    owner: *d\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "owner", "bob");
		expect(out).toContain("owner: bob");
		expect(out).not.toContain("owner: *d");
	});

	// A field can be present with a genuinely null value without being a
	// simple "key:" with nothing after the colon — that shape composes to a
	// zero-width Scalar node (still truthy), not a raw `null`. The construct
	// that actually parses to `Pair.value === null` in the `yaml` package is
	// the explicit-key indicator with no corresponding value line (`? key`,
	// no following `: value`) — valid YAML, no parse errors, semantically
	// equivalent to `key: null`.
	it("overwrites an explicit-key (null-valued) existing field instead of duplicating it", () => {
		// `pair?.value` is falsy for this pair, so the naive check falls
		// through to the "field not found" insertion branch below instead of
		// recognizing the field already exists, appending a second copy.
		const src =
			"---\nartifact:\n  spec:\n    label: Spec\n    ? status\n    owner: alice\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "status", "done");
		const statusOccurrences = ((out as string).match(/status/g) ?? []).length;
		expect(statusOccurrences).toBe(1);
		expect(out).toContain("status: done");
		expect(out).not.toContain("? status");
	});

	// `status:` with nothing after the colon (not even a trailing space)
	// parses to a real Scalar node (Pair.value is truthy, unlike the
	// explicit-key case above) whose range is zero-width, positioned
	// immediately after the colon. Splicing the replacement straight into
	// that zero-width range produces `status:done` — no space after the
	// colon, which is invalid YAML on re-parse and merges the following
	// field's key into the corrupted line (confirmed via MULTILINE_IMPLICIT_KEY
	// and a garbled `toJS()` key before this test's fix).
	it("adds a space when splicing into a bare key's zero-width empty value", () => {
		const src =
			"---\nartifact:\n  spec:\n    status:\n    owner: alice\n---\na >> P -> b\n";
		const out = setFrontmatterField(src, "artifact", "spec", "status", "done");
		expect(out).not.toBeNull();
		expect(out).toContain("status: done");
		expect(out).not.toContain("status:done");

		const reparsed = parseFrontmatterCst(out as string);
		expect(reparsed.doc.errors).toHaveLength(0);
		expect(reparsed.doc.getIn(["artifact", "spec", "status"])).toBe("done");
		expect(reparsed.doc.getIn(["artifact", "spec", "owner"])).toBe("alice");
	});

	it("does not crash inserting a new field when the map's last existing field is explicit-key null", () => {
		// The insertion branch anchors on the map's last item only to find
		// indentation/position — but if that unrelated last field's value is
		// itself raw `null` (not a Node), `(last.value as Node).range`
		// dereferences null at runtime despite the compile-time `as Node` cast.
		const src =
			"---\nartifact:\n  spec:\n    label: Spec\n    ? status\n---\na >> P -> b\n";
		expect(() =>
			setFrontmatterField(src, "artifact", "spec", "owner", "alice"),
		).not.toThrow();
		const out = setFrontmatterField(src, "artifact", "spec", "owner", "alice");
		expect(out).toContain("owner: alice");
	});

	// Replacing a multi-line block-literal (`|`) scalar's value must keep its
	// block-literal style (not flatten to plain) and must not lose the
	// newline that separated it from the following sibling field (#regression
	// found in packages/cli's meta-set block-scalar tests).
	it("preserves block-literal style and indent when replacing its value", () => {
		const src =
			"---\nartifact:\n  spec:\n    description: |\n      line one.\n      line two.\n    status: done\n---\na >> P -> b\n";
		const out = setFrontmatterField(
			src,
			"artifact",
			"spec",
			"description",
			"short.",
		);
		expect(out).toBe(
			"---\nartifact:\n  spec:\n    description: |-\n      short.\n    status: done\n---\na >> P -> b\n",
		);
	});

	// Same as above but for block-folded (`>`) style.
	it("preserves block-folded style and indent when replacing its value", () => {
		const src =
			"---\nartifact:\n  spec:\n    description: >\n      line one.\n      line two.\n    status: done\n---\na >> P -> b\n";
		const out = setFrontmatterField(
			src,
			"artifact",
			"spec",
			"description",
			"short.",
		);
		expect(out).toBe(
			"---\nartifact:\n  spec:\n    description: >-\n      short.\n    status: done\n---\na >> P -> b\n",
		);
	});

	// Regression guard: an ordinary single-line plain scalar's replacement
	// must remain unaffected by the block-scalar-preserving codepath.
	it("still renders a plain scalar replacement as plain (regression guard)", () => {
		const src =
			"---\nartifact:\n  spec:\n    description: old value\n    status: done\n---\na >> P -> b\n";
		const out = setFrontmatterField(
			src,
			"artifact",
			"spec",
			"description",
			"new value",
		);
		expect(out).toBe(
			"---\nartifact:\n  spec:\n    description: new value\n    status: done\n---\na >> P -> b\n",
		);
	});

	// A block-literal scalar's first content line may legally be blank
	// (a leading blank line inside `|` is valid YAML). The reindent lookup
	// must skip that blank line and derive `realTargetIndent` from the first
	// non-blank continuation line instead of hardcoding index 1 — otherwise
	// it derives an empty indent, and the replacement's continuation lines
	// come out unindented: invalid YAML on re-parse
	// (MULTILINE_IMPLICIT_KEY).
	it("derives block-literal reindent from the first non-blank continuation line when the first line is blank", () => {
		const src =
			"---\nartifact:\n  spec:\n    description: |\n\n      line two.\n      line three.\n    status: done\n---\na >> P -> b\n";
		const out = setFrontmatterField(
			src,
			"artifact",
			"spec",
			"description",
			"short.",
		);
		expect(out).toBe(
			"---\nartifact:\n  spec:\n    description: |-\n      short.\n    status: done\n---\na >> P -> b\n",
		);
		const reparsed = parseFrontmatterCst(out as string);
		expect(reparsed.doc.errors).toHaveLength(0);
		expect(reparsed.doc.getIn(["artifact", "spec", "description"])).toBe(
			"short.",
		);
		expect(reparsed.doc.getIn(["artifact", "spec", "status"])).toBe("done");
	});

	// A block-literal scalar's continuation lines may ALL be blank (a
	// degenerate but legal YAML shape: no actual content line exists to
	// derive a safe reindent from). `firstNonBlankContinuation` is then
	// `undefined` and `realTargetIndent` falls back to `null`, which skips
	// `renderValueLike`'s reindent entirely — leaving the replacement's
	// continuation lines at the throwaway skeleton's own indent instead of
	// the real document's. `fieldValueSplice` must decline this shape
	// (`{ ok: false }`) and let `setFrontmatterField` fall back to full
	// re-serialization instead of attempting an unreliable splice.
	it("falls back to full re-serialization when a block-literal's continuation lines are all blank", () => {
		const src =
			"---\nartifact:\n  spec:\n    description: |\n\n\n    status: done\n---\na >> P -> b\n";
		const out = setFrontmatterField(
			src,
			"artifact",
			"spec",
			"description",
			"short.",
		);
		const reparsed = parseFrontmatterCst(out as string);
		expect(reparsed.doc.errors).toHaveLength(0);
		expect(reparsed.doc.getIn(["artifact", "spec", "description"])).toBe(
			"short.",
		);
		expect(reparsed.doc.getIn(["artifact", "spec", "status"])).toBe("done");
	});

	// `renderValueLike` reuses the existing value's raw source as a skeleton
	// (`y: <original text>`), which is only valid standalone YAML when the
	// original value was itself a single scalar-shaped span. A block
	// sequence or a multi-key block map's own text glued onto `y: ` composes
	// into invalid YAML (the sequence dash or the second key land on the
	// wrong line), and `Document#toString()` throws on an errored document
	// with no validity check beforehand. These must fall back to full
	// re-serialization instead of crashing (final-review C1).
	describe("replacing an existing field whose value is a non-scalar node", () => {
		it("falls back cleanly when the existing value is a block sequence", () => {
			const src =
				"---\nartifact:\n  spec:\n    description:\n      - a\n      - b\n    status: done\n---\nx >> p -> spec\n";
			const out = setFrontmatterField(
				src,
				"artifact",
				"spec",
				"description",
				"short",
			);
			expect(out).toBe(
				"---\nartifact:\n  spec:\n    description: short\n    status: done\n---\nx >> p -> spec\n",
			);
			const reparsed = parseFrontmatterCst(out as string);
			expect(reparsed.doc.errors).toHaveLength(0);
			expect(reparsed.doc.getIn(["artifact", "spec", "description"])).toBe(
				"short",
			);
			expect(reparsed.doc.getIn(["artifact", "spec", "status"])).toBe("done");
		});

		it("falls back cleanly when the existing value is a multi-key block map", () => {
			const src =
				"---\nartifact:\n  spec:\n    criteria:\n      a: 1\n      b: 2\n    status: done\n---\nx >> p -> spec\n";
			const out = setFrontmatterField(
				src,
				"artifact",
				"spec",
				"criteria",
				"short",
			);
			expect(out).toBe(
				"---\nartifact:\n  spec:\n    criteria: short\n    status: done\n---\nx >> p -> spec\n",
			);
			const reparsed = parseFrontmatterCst(out as string);
			expect(reparsed.doc.errors).toHaveLength(0);
			expect(reparsed.doc.getIn(["artifact", "spec", "criteria"])).toBe(
				"short",
			);
			expect(reparsed.doc.getIn(["artifact", "spec", "status"])).toBe("done");
		});

		it("still succeeds when the existing value is a single-key block map", () => {
			const src =
				"---\nartifact:\n  spec:\n    criteria:\n      a: 1\n    status: done\n---\nx >> p -> spec\n";
			const out = setFrontmatterField(
				src,
				"artifact",
				"spec",
				"criteria",
				"short",
			);
			expect(out).toBe(
				"---\nartifact:\n  spec:\n    criteria: short\n    status: done\n---\nx >> p -> spec\n",
			);
			const reparsed = parseFrontmatterCst(out as string);
			expect(reparsed.doc.errors).toHaveLength(0);
			expect(reparsed.doc.getIn(["artifact", "spec", "criteria"])).toBe(
				"short",
			);
			expect(reparsed.doc.getIn(["artifact", "spec", "status"])).toBe("done");
		});

		it("succeeds when the existing value is a flow sequence", () => {
			const src =
				"---\nartifact:\n  spec:\n    tags: [a, b]\n    status: done\n---\nx >> p -> spec\n";
			const out = setFrontmatterField(src, "artifact", "spec", "tags", "short");
			expect(out).toBe(
				"---\nartifact:\n  spec:\n    tags: short\n    status: done\n---\nx >> p -> spec\n",
			);
			const reparsed = parseFrontmatterCst(out as string);
			expect(reparsed.doc.errors).toHaveLength(0);
			expect(reparsed.doc.getIn(["artifact", "spec", "tags"])).toBe("short");
			expect(reparsed.doc.getIn(["artifact", "spec", "status"])).toBe("done");
		});

		it("succeeds when the existing value is a flow map", () => {
			const src =
				"---\nartifact:\n  spec:\n    obj: { a: 1, b: 2 }\n    status: done\n---\nx >> p -> spec\n";
			const out = setFrontmatterField(src, "artifact", "spec", "obj", "short");
			expect(out).toBe(
				"---\nartifact:\n  spec:\n    obj: short\n    status: done\n---\nx >> p -> spec\n",
			);
			const reparsed = parseFrontmatterCst(out as string);
			expect(reparsed.doc.errors).toHaveLength(0);
			expect(reparsed.doc.getIn(["artifact", "spec", "obj"])).toBe("short");
			expect(reparsed.doc.getIn(["artifact", "spec", "status"])).toBe("done");
		});
	});
});

describe("parseFrontmatterCst yamlText", () => {
	it("exposes the raw yaml text between the fences", () => {
		const src = "---\nartifact:\n  spec:\n    status: todo\n---\na >> P -> b\n";
		const cst = parseFrontmatterCst(src);
		expect(cst.yamlText).toBe("artifact:\n  spec:\n    status: todo");
	});

	it("is empty when there is no frontmatter", () => {
		expect(parseFrontmatterCst("a >> P -> b\n").yamlText).toBe("");
	});
});

import { applySplices } from "./frontmatter-cst.js";

describe("applySplices", () => {
	it("replaces a single range", () => {
		expect(
			applySplices("hello world", [
				{ start: 6, end: 11, replacement: "there" },
			]),
		).toBe("hello there");
	});

	it("applies multiple non-overlapping splices regardless of input order", () => {
		const text = "aaa bbb ccc";
		const out = applySplices(text, [
			{ start: 8, end: 11, replacement: "ZZZ" },
			{ start: 0, end: 3, replacement: "XXX" },
		]);
		expect(out).toBe("XXX bbb ZZZ");
	});

	it("supports pure insertion (start === end)", () => {
		expect(applySplices("ab", [{ start: 1, end: 1, replacement: "-" }])).toBe(
			"a-b",
		);
	});

	it("throws on overlapping splices", () => {
		expect(() =>
			applySplices("abcdef", [
				{ start: 0, end: 3, replacement: "X" },
				{ start: 2, end: 5, replacement: "Y" },
			]),
		).toThrow(/overlap/);
	});
});

describe("newEntrySplice", () => {
	it("appends a new entry after the last sibling in a non-empty block section", () => {
		const yamlText =
			"artifact:\n  a:\n    label: A\nprocess:\n  p:\n    label: P";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(
			yamlText,
			doc,
			"artifact",
			"b",
			"label",
			"b",
			"\n",
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe(
			"artifact:\n  a:\n    label: A\n  b:\n    label: b\nprocess:\n  p:\n    label: P",
		);
	});

	it("creates the kind section itself when it doesn't exist at all", () => {
		const yamlText = "artifact:\n  a:\n    label: A";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(
			yamlText,
			doc,
			"process",
			"p",
			"label",
			"p",
			"\n",
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe(
			"artifact:\n  a:\n    label: A\nprocess:\n  p:\n    label: p",
		);
	});

	it("inserts into a flow-style section", () => {
		const yamlText = "artifact: { a: { label: A } }";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(
			yamlText,
			doc,
			"artifact",
			"b",
			"label",
			"b",
			"\n",
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe("artifact: { a: { label: A }, b: { label: b } }");
	});

	it("supports a non-string value (index: number)", () => {
		const yamlText = "artifact:\n  a:\n    label: A";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(
			yamlText,
			doc,
			"artifact",
			"b",
			"index",
			2,
			"\n",
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe("artifact:\n  a:\n    label: A\n  b:\n    index: 2");
	});

	// Same shape as the empty-flow-map bug in fieldValueSplice above: inserting
	// the first id right after `{` with no existing trailing text to lean on
	// for the closing brace's leading space.
	it("adds a trailing space when inserting the first entry into an empty flow-style section", () => {
		const yamlText = "artifact: {}";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(
			yamlText,
			doc,
			"artifact",
			"b",
			"label",
			"b",
			"\n",
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe("artifact: { b: { label: b } }");
	});

	it("returns unsupported for an empty block-style section (no sibling to anchor on)", () => {
		const yamlText = "artifact:\nprocess:\n  p:\n    label: P";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(
			yamlText,
			doc,
			"artifact",
			"b",
			"label",
			"b",
			"\n",
		);
		expect(result).toEqual({ ok: false, reason: "unsupported" });
	});

	// Mirror of fieldValueSplice's null-value guard (162485a): the last
	// sibling anchoring the insertion position can itself be an explicit-key
	// entry (`? b`, no value line) — legal YAML, `Pair.value` is genuinely
	// `null` at runtime. newEntrySplice had the same `(last.value as
	// Node).range` dereference pattern at two call sites but never got the
	// guard, so both crashed with `TypeError: Cannot read properties of
	// null (reading 'range')` (final-review I3).
	it("returns unsupported instead of crashing when the kind section's last sibling is explicit-key null", () => {
		const yamlText = "artifact:\n  a:\n    label: A\n  ? b";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		expect(() =>
			newEntrySplice(yamlText, doc, "artifact", "c", "label", "c", "\n"),
		).not.toThrow();
		const result = newEntrySplice(
			yamlText,
			doc,
			"artifact",
			"c",
			"label",
			"c",
			"\n",
		);
		expect(result).toEqual({ ok: false, reason: "unsupported" });
	});

	it("returns unsupported instead of crashing when the root map's last sibling is explicit-key null (kind section doesn't exist yet)", () => {
		const yamlText = "other:\n  x: 1\n? bar";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		expect(() =>
			newEntrySplice(yamlText, doc, "artifact", "c", "label", "c", "\n"),
		).not.toThrow();
		const result = newEntrySplice(
			yamlText,
			doc,
			"artifact",
			"c",
			"label",
			"c",
			"\n",
		);
		expect(result).toEqual({ ok: false, reason: "unsupported" });
	});
});
