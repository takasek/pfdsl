import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RECORD_SEP, trailerLines } from "./commit-trailers.mjs";

describe("trailerLines", () => {
	it("returns nothing for a message that is all prose", () => {
		assert.deepEqual(trailerLines("fix: something\n\njust prose here"), []);
	});

	it("collects the trailing Key: value paragraph", () => {
		const message = "fix: something\n\nprose\n\nReview: tool=simplify";
		assert.deepEqual(trailerLines(message), ["Review: tool=simplify"]);
	});

	it("keeps a record separated from Co-Authored-By by a blank line", () => {
		const message = [
			"fix: something",
			"",
			"prose",
			"",
			"Size-Override: the catalogue gained a pattern",
			"",
			"Co-Authored-By: Someone <s@example.com>",
		].join("\n");
		assert.deepEqual(trailerLines(message), [
			"Size-Override: the catalogue gained a pattern",
			"Co-Authored-By: Someone <s@example.com>",
		]);
	});

	it("stops at prose, so a commit explaining the token does not carry one", () => {
		const message = [
			"docs: explain the token",
			"",
			"A cycle writes Size-Override: <reason> when growth is intended.",
		].join("\n");
		assert.deepEqual(trailerLines(message), []);
	});

	it("cuts per commit so one message's prose cannot end the next one's region", () => {
		const blob = [
			"fix: a\n\ntrailing prose paragraph",
			"fix: b\n\nprose\n\nReview: tool=simplify",
		].join(RECORD_SEP);
		assert.deepEqual(trailerLines(blob), ["Review: tool=simplify"]);
	});

	// A Conventional Commits subject is `Key: value` shaped, so a message with
	// no prose between subject and trailer hands back both. Callers filter by
	// their own key rather than trusting every line here to be a declaration.
	it("includes a subject line the walk reaches, so callers must filter by key", () => {
		assert.deepEqual(trailerLines("fix: b\n\nReview: tool=simplify"), [
			"fix: b",
			"Review: tool=simplify",
		]);
	});
});
