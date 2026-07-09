import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	findSpecIdDefinitions,
	findStrictRefs,
	findDuplicateDefinitions,
	findDanglingStrictRefs,
	formatSpecIdViolations,
} from "./spec-id-check.mjs";

describe("findSpecIdDefinitions", () => {
	it("finds a single marker on a heading line", () => {
		const text = "line one\n## Multifile (SPEC_multifile_cross_ref)\nline three";
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
		const text = ["```", "[[SPEC_inside_fence]]", "```", "[[SPEC_outside_fence]]"].join(
			"\n",
		);
		const hits = findStrictRefs(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_outside_fence");
	});

	it("ignores strict references inside an inline code span", () => {
		const text = "See `[[SPEC_inline_example]]` for the syntax.";
		assert.deepEqual(findStrictRefs(text), []);
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
		assert.deepEqual(
			findDanglingStrictRefs(strictRefHits, definitionHits),
			[],
		);
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
