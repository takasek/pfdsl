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
		const text = "line one\n<!-- forward-ref: multifile-cross-ref -->\nline three";
		const hits = findForwardRefMarkers(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].line, 2);
		assert.equal(hits[0].id, "multifile-cross-ref");
	});

	it("finds multiple markers on separate lines", () => {
		const text =
			"<!-- forward-ref: foo -->\nfiller\n<!-- forward-ref: bar -->";
		const hits = findForwardRefMarkers(text);
		assert.equal(hits.length, 2);
		assert.deepEqual(
			hits.map((h) => h.id),
			["foo", "bar"],
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
		const text = "<!-- forward-ref: foo --> <!-- forward-ref: bar -->";
		const hits = findForwardRefMarkers(text);
		assert.equal(hits.length, 2);
		assert.deepEqual(
			hits.map((h) => h.id),
			["foo", "bar"],
		);
		assert.deepEqual(
			hits.map((h) => h.line),
			[1, 1],
		);
	});
});

describe("findImplementsMarkers", () => {
	it("finds a single marker", () => {
		const text = "line one\n<!-- implements: multifile-cross-ref -->\nline three";
		const hits = findImplementsMarkers(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].line, 2);
		assert.equal(hits[0].id, "multifile-cross-ref");
	});

	it("finds multiple markers on the same line", () => {
		const text = "<!-- implements: foo --> <!-- implements: bar -->";
		const hits = findImplementsMarkers(text);
		assert.equal(hits.length, 2);
		assert.deepEqual(
			hits.map((h) => h.id),
			["foo", "bar"],
		);
	});
});

describe("matchResolvedForwardRefs", () => {
	it("returns an empty array when a forward-ref has no matching implements", () => {
		const forwardRefHits = [{ file: "spec.md", line: 10, id: "future-thing" }];
		const implementsHits = [];
		assert.deepEqual(
			matchResolvedForwardRefs(forwardRefHits, implementsHits),
			[],
		);
	});

	it("matches when forward-ref and implements share the same id", () => {
		const forwardRefHits = [{ file: "spec.md", line: 10, id: "multifile" }];
		const implementsHits = [{ file: "spec.md", line: 20, id: "multifile" }];
		const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].id, "multifile");
		assert.deepEqual(resolved[0].forwardRefs, forwardRefHits);
		assert.deepEqual(resolved[0].implements, implementsHits);
	});

	it("matches ids across multiple files", () => {
		const forwardRefHits = [{ file: "spec.md", line: 10, id: "multifile" }];
		const implementsHits = [
			{ file: "other.md", line: 5, id: "multifile" },
		];
		const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].forwardRefs[0].file, "spec.md");
		assert.equal(resolved[0].implements[0].file, "other.md");
	});

	it("collects multiple implements hits for the same forward-ref id", () => {
		const forwardRefHits = [{ file: "spec.md", line: 10, id: "multifile" }];
		const implementsHits = [
			{ file: "a.md", line: 1, id: "multifile" },
			{ file: "b.md", line: 2, id: "multifile" },
		];
		const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].implements.length, 2);
	});

	it("does not duplicate an id when multiple forward-ref hits share it", () => {
		const forwardRefHits = [
			{ file: "a.md", line: 1, id: "multifile" },
			{ file: "b.md", line: 2, id: "multifile" },
		];
		const implementsHits = [{ file: "c.md", line: 3, id: "multifile" }];
		const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0].forwardRefs.length, 2);
	});
});

describe("formatResolvedForwardRefs", () => {
	it("formats output including file:line for both sides", () => {
		const resolved = [
			{
				id: "multifile",
				forwardRefs: [{ file: "spec.md", line: 10, id: "multifile" }],
				implements: [{ file: "other.md", line: 20, id: "multifile" }],
			},
		];
		const out = formatResolvedForwardRefs(resolved);
		assert.match(out, /multifile/);
		assert.match(out, /spec\.md:10/);
		assert.match(out, /other\.md:20/);
	});
});
