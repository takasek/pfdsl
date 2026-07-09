import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	findSpecIdDefinitions,
	findStrictRefs,
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
