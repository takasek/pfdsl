// The boundaries the spawned-script tests in script-argv.test.mjs do not
// reach: values Number() would quietly accept in a shape the caller did not
// type. Characterization of the digits-only rule, so a later relaxation to
// `Number.isInteger(Number(raw))` has to argue with these cases first.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIssueNumbers } from "./issue-args.mjs";

describe("parseIssueNumbers", () => {
	it("returns no numbers when the flag was never given", () => {
		assert.deepEqual(parseIssueNumbers(undefined), { ok: true, numbers: [] });
	});

	it("keeps repeated values in the order given", () => {
		assert.deepEqual(parseIssueNumbers(["744", "745"]), {
			ok: true,
			numbers: [744, 745],
		});
	});

	// Number(" 7 ") is 7 and Number("") is 0 — both are values the caller did
	// not type, and 0 in particular is a plausible-looking issue number.
	for (const raw of [
		"",
		" ",
		" 7 ",
		"7\n",
		"+7",
		"-7",
		"7e2",
		"0x10",
		"744.0",
	]) {
		it(`rejects ${JSON.stringify(raw)}`, () => {
			const result = parseIssueNumbers([raw]);
			assert.equal(result.ok, false);
			assert.match(result.message, /--issue/);
			assert.match(result.message, /got /);
		});
	}

	it("rejects the whole list when one value is malformed", () => {
		assert.equal(parseIssueNumbers(["744", "abc", "745"]).ok, false);
	});

	// Leading zeros survive: gh resolves the number, and rejecting them would
	// refuse a value that means exactly what it looks like.
	it("accepts leading zeros", () => {
		assert.deepEqual(parseIssueNumbers(["0744"]), {
			ok: true,
			numbers: [744],
		});
	});
});
