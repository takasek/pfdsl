import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { headingLevel, headingText, isHeading } from "./markdown-heading.mjs";

describe("isHeading", () => {
	it("accepts ATX headings of level 1 through 6", () => {
		for (let level = 1; level <= 6; level++) {
			const line = `${"#".repeat(level)} Title`;
			assert.equal(isHeading(line), true, line);
		}
	});

	it("rejects a run of 7 or more hashes, which CommonMark treats as prose", () => {
		assert.equal(isHeading("####### Title"), false);
	});

	it("rejects hashes with no following whitespace", () => {
		assert.equal(isHeading("#Title"), false);
	});

	it("rejects a line that does not start with a hash", () => {
		assert.equal(isHeading("Title"), false);
	});

	it("rejects a blank line", () => {
		assert.equal(isHeading(""), false);
	});

	it("does not tolerate leading whitespace before the hash", () => {
		assert.equal(isHeading("  # Title"), false);
	});
});

describe("headingLevel", () => {
	it("returns the hash count for a heading", () => {
		assert.equal(headingLevel("# Title"), 1);
		assert.equal(headingLevel("### Title"), 3);
		assert.equal(headingLevel("###### Title"), 6);
	});

	it("returns null for a non-heading line", () => {
		assert.equal(headingLevel("Title"), null);
		assert.equal(headingLevel("####### Title"), null);
	});
});

describe("headingText", () => {
	it("strips the marker and trims surrounding whitespace", () => {
		assert.equal(headingText("## Title"), "Title");
	});

	it("collapses multiple spaces after the marker", () => {
		assert.equal(headingText("###   Title  "), "Title");
	});

	it("returns null for a non-heading line", () => {
		assert.equal(headingText("Title"), null);
		assert.equal(headingText("####### Title"), null);
	});
});
