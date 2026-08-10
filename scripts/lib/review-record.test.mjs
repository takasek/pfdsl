import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RECORD_SEP } from "./commit-trailers.mjs";
import {
	CODE_PATH,
	CORRECTNESS_TOOLS,
	classifyCycle,
	GATE_TOOLS,
	parseReviewRecords,
	parseReviewTrailer,
	REVIEW_TOOLS,
} from "./review-record.mjs";

describe("parseReviewTrailer", () => {
	it("returns null for a line that is not the trailer", () => {
		assert.equal(parseReviewTrailer("Refs #561"), null);
	});

	it("parses a record naming the tool that reviewed", () => {
		const r = parseReviewTrailer("Review: tool=simplify");
		assert.equal(r.tool, "simplify");
		assert.equal(r.error, undefined);
	});

	it("rejects a tool outside the set the rule names", () => {
		const r = parseReviewTrailer("Review: tool=eyeballs");
		assert.match(r.error, /tool/);
	});

	it("rejects a record missing the tool field", () => {
		const r = parseReviewTrailer("Review:");
		assert.match(r.error, /tool/);
	});

	it("accepts each of the three perspective values added by #838", () => {
		for (const tool of ["correctness", "design", "experience"]) {
			const r = parseReviewTrailer(`Review: tool=${tool}`);
			assert.equal(r.tool, tool);
			assert.equal(r.error, undefined);
		}
	});
});

describe("GATE_TOOLS", () => {
	it("excludes code-review, which runs after a PR exists and so cannot satisfy a pre-commit trailer", () => {
		assert.equal(GATE_TOOLS.includes("code-review"), false);
	});

	it("keeps every other REVIEW_TOOLS value", () => {
		assert.deepEqual(
			GATE_TOOLS,
			REVIEW_TOOLS.filter((t) => t !== "code-review"),
		);
	});
});

describe("CORRECTNESS_TOOLS", () => {
	it("is exactly correctness and design, design subsuming correctness's brief", () => {
		assert.deepEqual(CORRECTNESS_TOOLS, ["correctness", "design"]);
	});
});

/** Commit messages as the callers hand them over: one blob, RECORD_SEP between. */
const messages = (...bodies) => bodies.join(RECORD_SEP);

describe("parseReviewRecords", () => {
	it("reads a record whose paragraph is not the message's last", () => {
		// The shape every commit in this repo actually has: the record sits in
		// its own paragraph, with Co-Authored-By following after a blank line.
		const records = parseReviewRecords(
			messages(
				"fix: something\n\nBody prose.\n\nRefs #757\n\nReview: tool=simplify\n\nCo-Authored-By: Someone <a@b>\n",
			),
		);
		assert.equal(records.length, 1);
		assert.equal(records[0].tool, "simplify");
	});

	it("ignores prose that merely begins a line with the token (#726)", () => {
		const records = parseReviewRecords(
			messages(
				"docs: explain the mechanism\n\nReview: the rule states that the trailer cannot be added\nafterwards, since it is part of a commit message.\n\nRefs #726\n",
			),
		);
		assert.deepEqual(records, []);
	});

	it("still reads the real record when the same commit also discusses it", () => {
		const records = parseReviewRecords(
			messages(
				"docs: explain the mechanism\n\nReview: the rule states that the trailer cannot be added\nafterwards, since it is part of a commit message.\n\nReview: tool=simplify\n",
			),
		);
		assert.equal(records.length, 1);
		assert.equal(records[0].tool, "simplify");
	});

	it("crosses a bare issue reference, which carries no colon", () => {
		// `Refs #603` is how this repo writes the reference, and one commit put
		// it between the record and Co-Authored-By. Stopping at it dropped a
		// genuine record (found by replaying the parser over origin/main).
		const records = parseReviewRecords(
			messages(
				"refactor: something\n\nBody prose.\n\nReview: tool=code-review\n\nRefs #603\n\nCo-Authored-By: Someone <a@b>\n",
			),
		);
		assert.equal(records.length, 1);
		assert.equal(records[0].tool, "code-review");
	});

	it("reads both passes when one commit recorded twice", () => {
		const records = parseReviewRecords(
			messages(
				"fix: two passes\n\nReview: tool=simplify\nReview: tool=code-review\n",
			),
		);
		assert.deepEqual(
			records.map((r) => r.tool),
			["simplify", "code-review"],
		);
	});

	it("keeps commits apart, so one message's prose cannot end another's region", () => {
		const records = parseReviewRecords(
			messages(
				"fix: a\n\nReview: tool=simplify\n",
				"docs: b\n\nTrailing prose with no record at all.\n",
				"fix: c\n\nReview: tool=code-review\n",
			),
		);
		assert.deepEqual(
			records.map((r) => r.tool),
			["simplify", "code-review"],
		);
	});
});

describe("CODE_PATH", () => {
	it("matches the code paths a cycle can change", () => {
		assert.equal(CODE_PATH.test("scripts/lib/review-record.mjs"), true);
		assert.equal(CODE_PATH.test("packages/core/src/parser.ts"), true);
	});

	it("does not match prose-only changes", () => {
		assert.equal(CODE_PATH.test(".pfdsl/roadmap.md"), false);
		assert.equal(CODE_PATH.test("docs/adr/README.md"), false);
	});
});

describe("classifyCycle", () => {
	it("reports nothing when a code cycle carries a record", () => {
		assert.deepEqual(
			classifyCycle({ changedFiles: ["scripts/a.mjs"], recordCount: 1 }),
			[],
		);
	});

	it("reports a missing record when a code cycle carries none", () => {
		assert.deepEqual(
			classifyCycle({
				changedFiles: ["packages/core/src/a.ts"],
				recordCount: 0,
			}),
			["changed code but carries no review record"],
		);
	});

	it("reports it when the code path is one entry among prose ones", () => {
		assert.deepEqual(
			classifyCycle({
				changedFiles: ["docs/adr/README.md", "scripts/gate-check.mjs"],
				recordCount: 0,
			}),
			["changed code but carries no review record"],
		);
	});

	it("stays silent about a prose cycle that carries no record", () => {
		assert.deepEqual(
			classifyCycle({ changedFiles: ["docs/a.md"], recordCount: 0 }),
			[],
		);
	});

	it("accepts a cycle that recorded several passes", () => {
		assert.deepEqual(
			classifyCycle({ changedFiles: ["scripts/a.mjs"], recordCount: 2 }),
			[],
		);
	});
});
