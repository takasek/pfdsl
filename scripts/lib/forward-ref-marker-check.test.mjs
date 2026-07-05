import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	findForwardRefMarkers,
	findImplementsMarkers,
	matchResolvedForwardRefs,
	formatResolvedForwardRefs,
} from "./forward-ref-marker-check.mjs";

describe("findForwardRefMarkers", () => {
	it("finds a single marker", () => {
		const text = "line one\n[[SPEC_multifile_cross_ref?]]\nline three";
		const hits = findForwardRefMarkers(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].line, 2);
		assert.equal(hits[0].id, "SPEC_multifile_cross_ref");
	});

	it("finds multiple markers on separate lines", () => {
		const text = "[[SPEC_foo?]]\nfiller\n[[SPEC_bar?]]";
		const hits = findForwardRefMarkers(text);
		assert.equal(hits.length, 2);
		assert.deepEqual(
			hits.map((h) => h.id),
			["SPEC_foo", "SPEC_bar"],
		);
		assert.deepEqual(
			hits.map((h) => h.line),
			[1, 3],
		);
	});

	it("returns an empty array when no marker is present", () => {
		assert.deepEqual(findForwardRefMarkers("nothing to see here"), []);
	});

	it("finds multiple markers on the same line", () => {
		const text = "[[SPEC_foo?]] [[SPEC_bar?]]";
		const hits = findForwardRefMarkers(text);
		assert.equal(hits.length, 2);
		assert.deepEqual(
			hits.map((h) => h.id),
			["SPEC_foo", "SPEC_bar"],
		);
		assert.deepEqual(
			hits.map((h) => h.line),
			[1, 1],
		);
	});

	it("does not match a strict reference without the trailing '?' (out of scope, #328)", () => {
		const text = "line one\n[[SPEC_multifile_cross_ref]]\nline three";
		assert.deepEqual(findForwardRefMarkers(text), []);
	});

	it("ignores markers inside a fenced code block", () => {
		const text = [
			"before",
			"```",
			"[[SPEC_inside_fence?]]",
			"```",
			"[[SPEC_outside_fence?]]",
		].join("\n");
		const hits = findForwardRefMarkers(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_outside_fence");
	});

	it("ignores markers inside a tilde-fenced code block", () => {
		const text = ["~~~", "[[SPEC_inside_fence?]]", "~~~"].join("\n");
		assert.deepEqual(findForwardRefMarkers(text), []);
	});
});

describe("findImplementsMarkers", () => {
	it("finds a single marker on a heading line", () => {
		const text = "line one\n## Multifile (SPEC_multifile_cross_ref)\nline three";
		const hits = findImplementsMarkers(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].line, 2);
		assert.equal(hits[0].id, "SPEC_multifile_cross_ref");
	});

	it("finds markers across multiple heading levels", () => {
		const text = "# Foo (SPEC_foo)\n\n###### Bar (SPEC_bar)";
		const hits = findImplementsMarkers(text);
		assert.equal(hits.length, 2);
		assert.deepEqual(
			hits.map((h) => h.id),
			["SPEC_foo", "SPEC_bar"],
		);
	});

	it("does not match (SPEC_xxx) when not on a heading line", () => {
		const text = "This is prose that mentions (SPEC_foo) in passing.";
		assert.deepEqual(findImplementsMarkers(text), []);
	});

	it("does not match a heading whose trailing text isn't the marker", () => {
		const text = "## Some heading (SPEC_foo) trailing text";
		assert.deepEqual(findImplementsMarkers(text), []);
	});

	it("tolerates trailing whitespace after the marker", () => {
		const text = "## Heading (SPEC_foo)   ";
		const hits = findImplementsMarkers(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_foo");
	});

	it("ignores heading-like lines inside a fenced code block", () => {
		const text = [
			"before",
			"```",
			"## Fake heading (SPEC_inside_fence)",
			"```",
			"## Real heading (SPEC_outside_fence)",
		].join("\n");
		const hits = findImplementsMarkers(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].id, "SPEC_outside_fence");
	});
});

describe("matchResolvedForwardRefs", () => {
	it("returns an empty array when a forward-ref has no matching implements", () => {
		const forwardRefHits = [
			{ file: "spec.md", line: 10, id: "SPEC_future_thing" },
		];
		const implementsHits = [];
		assert.deepEqual(
			matchResolvedForwardRefs(forwardRefHits, implementsHits),
			[],
		);
	});

	it("matches when forward-ref and implements share the same id", () => {
		const forwardRefHits = [{ file: "spec.md", line: 10, id: "SPEC_multifile" }];
		const implementsHits = [{ file: "spec.md", line: 20, id: "SPEC_multifile" }];
		const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].id, "SPEC_multifile");
		assert.deepEqual(resolved[0].forwardRefs, forwardRefHits);
		assert.deepEqual(resolved[0].implements, implementsHits);
	});

	it("matches ids across multiple files", () => {
		const forwardRefHits = [{ file: "spec.md", line: 10, id: "SPEC_multifile" }];
		const implementsHits = [
			{ file: "other.md", line: 5, id: "SPEC_multifile" },
		];
		const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].forwardRefs[0].file, "spec.md");
		assert.equal(resolved[0].implements[0].file, "other.md");
	});

	it("collects multiple implements hits for the same forward-ref id", () => {
		const forwardRefHits = [{ file: "spec.md", line: 10, id: "SPEC_multifile" }];
		const implementsHits = [
			{ file: "a.md", line: 1, id: "SPEC_multifile" },
			{ file: "b.md", line: 2, id: "SPEC_multifile" },
		];
		const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].implements.length, 2);
	});

	it("does not duplicate an id when multiple forward-ref hits share it", () => {
		const forwardRefHits = [
			{ file: "a.md", line: 1, id: "SPEC_multifile" },
			{ file: "b.md", line: 2, id: "SPEC_multifile" },
		];
		const implementsHits = [{ file: "c.md", line: 3, id: "SPEC_multifile" }];
		const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].forwardRefs.length, 2);
	});
});

describe("formatResolvedForwardRefs", () => {
	it("formats output including file:line for both sides", () => {
		const resolved = [
			{
				id: "SPEC_multifile",
				forwardRefs: [{ file: "spec.md", line: 10, id: "SPEC_multifile" }],
				implements: [{ file: "other.md", line: 20, id: "SPEC_multifile" }],
			},
		];
		const out = formatResolvedForwardRefs(resolved);
		assert.match(out, /SPEC_multifile/);
		assert.match(out, /spec\.md:10/);
		assert.match(out, /other\.md:20/);
	});
});
