import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatIdForCliArg, joinIdsForCliArg } from "./cli-id-arg.mjs";

describe("formatIdForCliArg (#1125 review defect 2)", () => {
	it("leaves a bare id unquoted", () => {
		assert.equal(formatIdForCliArg("legacy_in"), "legacy_in");
	});

	it("quotes an id that contains a comma", () => {
		assert.equal(formatIdForCliArg("a,b"), '"a,b"');
	});

	it("escapes a double quote inside a quoted id", () => {
		assert.equal(formatIdForCliArg('a"b'), '"a\\"b"');
	});
});

describe("joinIdsForCliArg (#1125 review defect 2)", () => {
	it("joins bare ids with a plain comma, unchanged from before", () => {
		assert.equal(joinIdsForCliArg(["a", "b"]), "a,b");
	});

	it("keeps a comma-carrying id quoted so it survives the CLI's own comma-split", () => {
		// Round trip through the CLI's own quote-aware id-list parser
		// (parseIdList in packages/core/src/formatter.ts) must recover the
		// original ids, not split "a,b" into "a" and "b" (#1125 review defect
		// 2's exact failure mode — the sweep script hits this the same way a
		// direct `pfdsl delete` call does, since both join ids with a bare
		// comma before this fix).
		const joined = joinIdsForCliArg(["a,b", "c"]);
		assert.equal(joined, '"a,b",c');
	});
});
