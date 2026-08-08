import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	classifyCycle,
	IN_SAMPLE_PATH,
	mergeCycleRecords,
	parseMeasurementRecords,
	parseMeasurementTrailer,
	RECORD_SEP,
} from "./review-measurement.mjs";

describe("parseMeasurementTrailer", () => {
	it("returns null for a line that is not the trailer", () => {
		assert.equal(parseMeasurementTrailer("Refs #561"), null);
	});

	it("parses an in-sample record with counts", () => {
		const r = parseMeasurementTrailer(
			"Review-Measurement: sample=in new=2 adopted=1",
		);
		assert.equal(r.sample, "in");
		assert.equal(r.new, 2);
		assert.equal(r.adopted, 1);
	});

	it("parses a zero-finding record, which is the denominator the rate depends on", () => {
		const r = parseMeasurementTrailer(
			"Review-Measurement: sample=in new=0 adopted=0",
		);
		assert.equal(r.sample, "in");
		assert.equal(r.new, 0);
		assert.equal(r.error, undefined);
	});

	it("parses a quoted angles field containing spaces and semicolons", () => {
		const r = parseMeasurementTrailer(
			'Review-Measurement: sample=in new=0 adopted=0 angles="branch coverage; error paths"',
		);
		assert.equal(r.angles, "branch coverage; error paths");
	});

	it("accepts an out-of-sample record without counts", () => {
		const r = parseMeasurementTrailer("Review-Measurement: sample=out");
		assert.equal(r.sample, "out");
		assert.equal(r.error, undefined);
	});

	it("rejects an unknown sample value", () => {
		const r = parseMeasurementTrailer(
			"Review-Measurement: sample=maybe new=0 adopted=0",
		);
		assert.match(r.error, /sample/);
	});

	it("rejects an in-sample record missing the new count", () => {
		const r = parseMeasurementTrailer(
			"Review-Measurement: sample=in adopted=0",
		);
		assert.match(r.error, /new/);
	});

	it("rejects adopted exceeding new, which cannot happen by definition", () => {
		const r = parseMeasurementTrailer(
			"Review-Measurement: sample=in new=1 adopted=3",
		);
		assert.match(r.error, /adopted/);
	});
});

/** Commit messages as the callers hand them over: one blob, RECORD_SEP between. */
const messages = (...bodies) => bodies.join(RECORD_SEP);

describe("parseMeasurementRecords", () => {
	it("reads a record whose paragraph is not the message's last", () => {
		// The shape every commit in this repo actually has: the record sits in
		// its own paragraph, with Co-Authored-By following after a blank line.
		const records = parseMeasurementRecords(
			messages(
				"fix: something\n\nBody prose.\n\nRefs #757\n\nReview-Measurement: sample=in new=2 adopted=1\n\nCo-Authored-By: Someone <a@b>\n",
			),
		);
		assert.equal(records.length, 1);
		assert.equal(records[0].new, 2);
	});

	it("ignores prose that merely begins a line with the token (#726)", () => {
		const records = parseMeasurementRecords(
			messages(
				"docs: explain the mechanism\n\nReview-Measurement: the rule states that the trailer cannot be added\nafterwards, since it is part of a commit message.\n\nRefs #726\n",
			),
		);
		assert.deepEqual(records, []);
	});

	it("still reads the real record when the same commit also discusses it", () => {
		const records = parseMeasurementRecords(
			messages(
				"docs: explain the mechanism\n\nReview-Measurement: the rule states that the trailer cannot be added\nafterwards, since it is part of a commit message.\n\nReview-Measurement: sample=out\n",
			),
		);
		assert.equal(records.length, 1);
		assert.equal(records[0].sample, "out");
	});

	it("crosses a bare issue reference, which carries no colon", () => {
		// `Refs #603` is how this repo writes the reference, and one commit put
		// it between the record and Co-Authored-By. Stopping at it dropped a
		// genuine record (found by replaying the parser over origin/main).
		const records = parseMeasurementRecords(
			messages(
				"refactor: something\n\nBody prose.\n\nReview-Measurement: sample=in new=2 adopted=2\n\nRefs #603\n\nCo-Authored-By: Someone <a@b>\n",
			),
		);
		assert.equal(records.length, 1);
		assert.equal(records[0].adopted, 2);
	});

	it("reads both passes when one commit recorded twice", () => {
		const records = parseMeasurementRecords(
			messages(
				"fix: two passes\n\nReview-Measurement: sample=in new=1 adopted=1\nReview-Measurement: sample=out\n",
			),
		);
		assert.deepEqual(
			records.map((r) => r.sample),
			["in", "out"],
		);
	});

	it("keeps commits apart, so one message's prose cannot end another's region", () => {
		const records = parseMeasurementRecords(
			messages(
				"fix: a\n\nReview-Measurement: sample=in new=1 adopted=0\n",
				"docs: b\n\nTrailing prose with no record at all.\n",
				"fix: c\n\nReview-Measurement: sample=out\n",
			),
		);
		assert.deepEqual(
			records.map((r) => r.sample),
			["in", "out"],
		);
	});
});

describe("IN_SAMPLE_PATH", () => {
	it("matches the code paths that put a cycle in sample", () => {
		assert.equal(
			IN_SAMPLE_PATH.test("scripts/lib/review-measurement.mjs\n"),
			true,
		);
		assert.equal(IN_SAMPLE_PATH.test("packages/core/src/parser.ts\n"), true);
	});

	it("does not match prose-only changes, which stay out of sample", () => {
		assert.equal(
			IN_SAMPLE_PATH.test(".pfdsl/roadmap.md\ndocs/adr/README.md\n"),
			false,
		);
	});

	it("matches when a code path appears on any line of a file list", () => {
		assert.equal(
			IN_SAMPLE_PATH.test("docs/adr/README.md\nscripts/gate-check.mjs\n"),
			true,
		);
	});
});

describe("classifyCycle", () => {
	it("reports nothing when a code cycle recorded one in-sample trailer", () => {
		const c = classifyCycle({
			changedFiles: "scripts/a.mjs\n",
			trailerCount: 1,
			sample: "in",
		});
		assert.deepEqual(c.issues, []);
	});

	it("reports a missing record when a code cycle recorded nothing", () => {
		const c = classifyCycle({
			changedFiles: "packages/core/src/a.ts\n",
			trailerCount: 0,
		});
		assert.deepEqual(
			c.issues.map((i) => i.type),
			["missing"],
		);
	});

	it("stays silent about a prose cycle that recorded nothing", () => {
		const c = classifyCycle({ changedFiles: "docs/a.md\n", trailerCount: 0 });
		assert.deepEqual(c.issues, []);
	});

	it("reports sample=out on a cycle that changed code, which removes it from the denominator", () => {
		const c = classifyCycle({
			changedFiles: "scripts/a.mjs\n",
			trailerCount: 1,
			sample: "out",
		});
		assert.deepEqual(
			c.issues.map((i) => i.type),
			["mismatch"],
		);
	});

	it("reports sample=in on a cycle that changed no code, which pads the denominator", () => {
		const c = classifyCycle({
			changedFiles: "docs/a.md\n",
			trailerCount: 1,
			sample: "in",
		});
		assert.deepEqual(
			c.issues.map((i) => i.type),
			["mismatch"],
		);
	});

	it("accepts a cycle that recorded several passes, which is how reviewing twice looks", () => {
		const c = classifyCycle({
			changedFiles: "scripts/a.mjs\n",
			trailerCount: 2,
			sample: "in",
		});
		assert.deepEqual(c.issues, []);
	});
});

describe("tool field", () => {
	it("parses the tool that produced the findings", () => {
		const r = parseMeasurementTrailer(
			"Review-Measurement: sample=in new=1 adopted=1 tool=code-review",
		);
		assert.equal(r.tool, "code-review");
	});

	it("rejects a tool outside the three the rule names", () => {
		const r = parseMeasurementTrailer(
			"Review-Measurement: sample=in new=1 adopted=1 tool=eyeballs",
		);
		assert.match(r.error, /tool/);
	});

	it("leaves the tool unspecified on records written before the field existed", () => {
		const r = parseMeasurementTrailer(
			"Review-Measurement: sample=in new=1 adopted=1",
		);
		assert.equal(r.error, undefined);
		assert.equal(r.tool, undefined);
	});
});

describe("mergeCycleRecords", () => {
	it("returns null for a cycle that recorded nothing", () => {
		assert.equal(mergeCycleRecords([]), null);
	});

	it("passes a single record through", () => {
		const r = mergeCycleRecords([
			{ sample: "in", new: 2, adopted: 1, tool: "simplify" },
		]);
		assert.equal(r.sample, "in");
		assert.equal(r.new, 2);
		assert.deepEqual(r.tools, ["simplify"]);
	});

	it("sums the findings of every review pass in one cycle", () => {
		// A cycle commonly reviews more than once: self review, then the tool,
		// then the fixes the tool prompted.
		const r = mergeCycleRecords([
			{ sample: "in", new: 1, adopted: 1, tool: "simplify" },
			{ sample: "in", new: 2, adopted: 2, tool: "code-review" },
		]);
		assert.equal(r.new, 3);
		assert.equal(r.adopted, 3);
		assert.deepEqual(r.tools, ["simplify", "code-review"]);
	});

	it("counts the cycle as in-sample when any pass says so", () => {
		// Order must not decide it: taking the first record found made the
		// classification depend on which commit git happened to list first.
		const r = mergeCycleRecords([
			{ sample: "out" },
			{ sample: "in", new: 2, adopted: 2, tool: "code-review" },
		]);
		assert.equal(r.sample, "in");
		assert.equal(r.new, 2);
	});

	it("keeps a malformed pass visible instead of averaging it away", () => {
		const r = mergeCycleRecords([
			{ sample: "in", error: "adopted cannot exceed new" },
		]);
		assert.match(r.error, /adopted/);
	});
});
