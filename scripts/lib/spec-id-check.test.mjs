import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	findBareSectionReferences,
	findDanglingStrictRefs,
	findDuplicateDefinitions,
	findMultipleIdsOnBlock,
	findSpecIdDefinitions,
	findStrictRefs,
	formatSpecIdViolations,
} from "./spec-id-check.mjs";

describe("findBareSectionReferences", () => {
	it("matches exact numbered sections and sentence-final punctuation", () => {
		const text =
			"## 2.3. Rule (SPEC_x)\n§2.3。 § 2.3. §2.30 §2.3.1\n### 15.1 A (SPEC_a)\n§15.11 §15.1";
		assert.deepEqual(findBareSectionReferences(text), [
			{ line: 2, section: "2.3", id: "SPEC_x" },
			{ line: 2, section: "2.3", id: "SPEC_x" },
			{ line: 4, section: "15.1", id: "SPEC_a" },
		]);
	});
	it("ignores code, unnumbered headings, and unlabelled child sections", () => {
		const text =
			"## 2.7 Rule (SPEC_x)\n§2.7.5 `§2.7`\n```\n§2.7\n## 3 Code (SPEC_code)\n```\n## 4 No id\n## Other (SPEC_y)\n§3 §4";
		assert.deepEqual(findBareSectionReferences(text), []);
	});
});

describe("findMultipleIdsOnBlock", () => {
	it("CommonMark List items: groups the first paragraph's continuation but separates later paragraphs", () => {
		assert.deepEqual(
			findMultipleIdsOnBlock(
				"- first (SPEC_a)\n  continuation (SPEC_b)\n\n  second (SPEC_c)",
			),
			[{ line: 1, ids: ["SPEC_a", "SPEC_b"] }],
		);
	});
	it("CommonMark keeps a non-one ordered marker in the preceding paragraph", () => {
		assert.deepEqual(
			findMultipleIdsOnBlock("paragraph (SPEC_a)\n2. rule (SPEC_b)"),
			[{ line: 1, ids: ["SPEC_a", "SPEC_b"] }],
		);
	});
	it("CommonMark separates an ATX heading from the following paragraph without a blank line", () => {
		assert.deepEqual(
			findMultipleIdsOnBlock("### Rule (SPEC_a)\nDescription (SPEC_b)"),
			[],
		);
	});
	it("rejects two ids on one heading block", () => {
		assert.deepEqual(findMultipleIdsOnBlock("### Rule (SPEC_a) (SPEC_b)"), [
			{ line: 1, ids: ["SPEC_a", "SPEC_b"] },
		]);
	});
	it("accepts one id per separate heading", () => {
		assert.deepEqual(
			findMultipleIdsOnBlock("### A (SPEC_a)\n### B (SPEC_b)"),
			[],
		);
	});
	it("groups definitions on different lines of one paragraph", () => {
		assert.deepEqual(findMultipleIdsOnBlock("rule (SPEC_a)\nand (SPEC_b)"), [
			{ line: 1, ids: ["SPEC_a", "SPEC_b"] },
		]);
	});
});

describe("HTML exclusion", () => {
	// ADR-0027 defines markers on headings, list items, table rows and
	// paragraphs, and rejects invisible HTML-comment markers. References in
	// HTML are still checked, so a stale or mistyped one cannot hide there.
	it("ignores a definition inside an HTML comment but checks its reference", () => {
		const text = "<!-- (SPEC_x) [[SPEC_x]] -->";
		assert.deepEqual(findSpecIdDefinitions(text), []);
		assert.deepEqual(findStrictRefs(text), [{ line: 1, id: "SPEC_x" }]);
	});
	it("ignores definitions inside a CommonMark HTML block", () => {
		const text = "<div>\nrule (SPEC_a)\nmore (SPEC_b)\n</div>";
		assert.deepEqual(findSpecIdDefinitions(text), []);
		assert.deepEqual(findMultipleIdsOnBlock(text), []);
	});
	it("checks references and bare section references inside an HTML block", () => {
		const text =
			"## 2.3 Rule (SPEC_x)\n\n<details>\n[[SPEC_typo]] §2.3\n</details>";
		assert.deepEqual(findStrictRefs(text), [{ line: 4, id: "SPEC_typo" }]);
		assert.deepEqual(findBareSectionReferences(text), [
			{ line: 4, section: "2.3", id: "SPEC_x" },
		]);
	});
	it("keeps a definition in paragraph text between inline HTML tags", () => {
		assert.deepEqual(findSpecIdDefinitions("rule <span>(SPEC_a)</span>"), [
			{ line: 1, id: "SPEC_a" },
		]);
	});
});

describe("parsed code exclusion", () => {
	it("keeps SPEC markers in separate table cells outside code spans", () => {
		const text =
			"| a | b |\n| --- | --- |\n| ` | (SPEC_real) [[SPEC_real]] |\n| ` | text |";
		assert.deepEqual(findSpecIdDefinitions(text), [
			{ line: 3, id: "SPEC_real" },
		]);
		assert.deepEqual(findStrictRefs(text), [{ line: 3, id: "SPEC_real" }]);
	});
	it("ignores multiline code examples while preserving real marker line numbers", () => {
		const text =
			"😀 `example\r\n(SPEC_quoted) [[SPEC_quoted]]\r\n` (SPEC_real) [[SPEC_real]]\r\n";
		assert.deepEqual(findSpecIdDefinitions(text), [
			{ line: 3, id: "SPEC_real" },
		]);
		assert.deepEqual(findStrictRefs(text), [{ line: 3, id: "SPEC_real" }]);
	});

	it("does not create markers by joining prose across code spans", () => {
		const text = "(SPEC_`example`fake) [[SPEC_`example`fake]]";
		assert.deepEqual(findSpecIdDefinitions(text), []);
		assert.deepEqual(findStrictRefs(text), []);
	});
});

describe("findSpecIdDefinitions", () => {
	it("finds a single marker on a heading line", () => {
		const text =
			"line one\n## Multifile (SPEC_multifile_cross_ref)\nline three";
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].line, 2);
		assert.equal(hits[0].id, "SPEC_multifile_cross_ref");
	});

	it("finds a marker on a list item line", () => {
		const text = "- some item (SPEC_list_item)";
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_list_item");
	});

	it("finds a marker on a table row line", () => {
		const text = "| a | b (SPEC_table_row) |";
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_table_row");
	});

	it("finds a marker on a bare paragraph line", () => {
		const text = "Just a plain paragraph (SPEC_paragraph) with text after.";
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_paragraph");
	});

	it("finds multiple markers on separate lines", () => {
		const text = "(SPEC_foo)\nfiller\n(SPEC_bar)";
		const hits = findSpecIdDefinitions(text);
		assert.deepEqual(
			hits.map((h) => h.id),
			["SPEC_foo", "SPEC_bar"],
		);
	});

	it("returns an empty array when no marker is present", () => {
		assert.deepEqual(findSpecIdDefinitions("nothing to see here"), []);
	});

	it("ignores markers inside a fenced code block", () => {
		const text = [
			"before",
			"```",
			"## Fake heading (SPEC_inside_fence)",
			"```",
			"## Real heading (SPEC_outside_fence)",
		].join("\n");
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_outside_fence");
	});

	it("ignores markers inside a tilde-fenced code block", () => {
		const text = ["~~~", "(SPEC_inside_fence)", "~~~"].join("\n");
		assert.deepEqual(findSpecIdDefinitions(text), []);
	});

	it("keeps a four-backtick block open through a three-backtick line", () => {
		const text = [
			"````md",
			"```",
			"## Fake heading (SPEC_inside_fence)",
			"````",
			"## Real heading (SPEC_outside_fence)",
		].join("\n");
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_outside_fence");
	});

	it("ignores markers inside an inline code span", () => {
		const text = "See `(SPEC_inline_example)` for the syntax.";
		assert.deepEqual(findSpecIdDefinitions(text), []);
	});

	it("still finds a marker outside an inline code span on the same line", () => {
		const text = "See `some code` for details (SPEC_outside_span).";
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_outside_span");
	});

	it("ignores markers inside a double-backtick inline code span", () => {
		const text = "See ``(SPEC_double_backtick)`` for the syntax.";
		assert.deepEqual(findSpecIdDefinitions(text), []);
	});

	it("handles single and double backtick spans mixed on the same line", () => {
		const text =
			"`(SPEC_single)` then ``(SPEC_double)`` then (SPEC_real) is defined.";
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_real");
	});

	it("treats an embedded single backtick inside a double-backtick span as content", () => {
		const text = "See ``(SPEC_embedded)`extra`` then (SPEC_after) is real.";
		const hits = findSpecIdDefinitions(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_after");
	});
});

describe("findStrictRefs", () => {
	it("finds a single strict reference", () => {
		const text = "line one\n[[SPEC_multifile_cross_ref]]\nline three";
		const hits = findStrictRefs(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].line, 2);
		assert.equal(hits[0].id, "SPEC_multifile_cross_ref");
	});

	it("does not match a permissive reference with a trailing '?'", () => {
		const text = "[[SPEC_multifile_cross_ref?]]";
		assert.deepEqual(findStrictRefs(text), []);
	});

	it("finds multiple strict references on the same line", () => {
		const text = "[[SPEC_foo]] [[SPEC_bar]]";
		const hits = findStrictRefs(text);
		assert.deepEqual(
			hits.map((h) => h.id),
			["SPEC_foo", "SPEC_bar"],
		);
	});

	it("ignores strict references inside a fenced code block", () => {
		const text = [
			"```",
			"[[SPEC_inside_fence]]",
			"```",
			"[[SPEC_outside_fence]]",
		].join("\n");
		const hits = findStrictRefs(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_outside_fence");
	});

	it("ignores strict references inside an inline code span", () => {
		const text = "See `[[SPEC_inline_example]]` for the syntax.";
		assert.deepEqual(findStrictRefs(text), []);
	});

	it("ignores strict references inside a double-backtick inline code span", () => {
		const text = "See ``[[SPEC_double_backtick]]`` for the syntax.";
		assert.deepEqual(findStrictRefs(text), []);
	});

	it("handles single and double backtick spans mixed on the same line", () => {
		const text =
			"`[[SPEC_single]]` then ``[[SPEC_double]]`` then [[SPEC_real]] is a ref.";
		const hits = findStrictRefs(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_real");
	});
});

describe("findDuplicateDefinitions", () => {
	it("returns an empty array when every id is defined once", () => {
		const definitionHits = [
			{ file: "a.md", line: 1, id: "SPEC_foo" },
			{ file: "a.md", line: 2, id: "SPEC_bar" },
		];
		assert.deepEqual(findDuplicateDefinitions(definitionHits), []);
	});

	it("flags an id defined twice in the same file", () => {
		const definitionHits = [
			{ file: "a.md", line: 1, id: "SPEC_foo" },
			{ file: "a.md", line: 5, id: "SPEC_foo" },
		];
		const dupes = findDuplicateDefinitions(definitionHits);
		assert.equal(dupes.length, 1);
		assert.equal(dupes[0].id, "SPEC_foo");
		assert.equal(dupes[0].definitions.length, 2);
	});

	it("flags an id defined twice across different files", () => {
		const definitionHits = [
			{ file: "a.md", line: 1, id: "SPEC_foo" },
			{ file: "b.md", line: 1, id: "SPEC_foo" },
		];
		const dupes = findDuplicateDefinitions(definitionHits);
		assert.equal(dupes.length, 1);
		assert.deepEqual(
			dupes[0].definitions.map((h) => h.file),
			["a.md", "b.md"],
		);
	});
});

describe("findDanglingStrictRefs", () => {
	it("returns an empty array when every strict ref has a matching definition", () => {
		const strictRefHits = [{ file: "a.md", line: 1, id: "SPEC_foo" }];
		const definitionHits = [{ file: "b.md", line: 1, id: "SPEC_foo" }];
		assert.deepEqual(findDanglingStrictRefs(strictRefHits, definitionHits), []);
	});

	it("flags a strict ref with no matching definition anywhere", () => {
		const strictRefHits = [{ file: "a.md", line: 1, id: "SPEC_missing" }];
		const definitionHits = [];
		const dangling = findDanglingStrictRefs(strictRefHits, definitionHits);
		assert.equal(dangling.length, 1);
		assert.equal(dangling[0].id, "SPEC_missing");
		assert.equal(dangling[0].refs.length, 1);
	});

	it("groups multiple dangling refs to the same id together", () => {
		const strictRefHits = [
			{ file: "a.md", line: 1, id: "SPEC_missing" },
			{ file: "a.md", line: 9, id: "SPEC_missing" },
		];
		const dangling = findDanglingStrictRefs(strictRefHits, []);
		assert.equal(dangling.length, 1);
		assert.equal(dangling[0].refs.length, 2);
	});
});

describe("formatSpecIdViolations", () => {
	it("formats duplicate and dangling violations with file:line", () => {
		const duplicates = [
			{
				id: "SPEC_foo",
				definitions: [
					{ file: "a.md", line: 1, id: "SPEC_foo" },
					{ file: "b.md", line: 2, id: "SPEC_foo" },
				],
			},
		];
		const dangling = [
			{
				id: "SPEC_missing",
				refs: [{ file: "c.md", line: 3, id: "SPEC_missing" }],
			},
		];
		const out = formatSpecIdViolations(duplicates, dangling);
		assert.match(out, /SPEC_foo/);
		assert.match(out, /a\.md:1/);
		assert.match(out, /b\.md:2/);
		assert.match(out, /SPEC_missing/);
		assert.match(out, /c\.md:3/);
	});

	it("returns an empty string when there are no violations", () => {
		assert.equal(formatSpecIdViolations([], []), "");
	});
});
