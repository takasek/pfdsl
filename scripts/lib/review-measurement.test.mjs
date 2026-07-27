import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	RECORD_SEP,
	FIELD_SEP,
	parseMeasurementTrailer,
	extractMeasurements,
	summarize,
	TARGET_SAMPLE_COUNT,
	IN_SAMPLE_PATH,
	parseSinceArg,
} from "./review-measurement.mjs";

const log = (...entries) => entries.map(([sha, body]) => `${sha}${FIELD_SEP}${body}`).join(RECORD_SEP);

describe("parseMeasurementTrailer", () => {
	it("returns null for a line that is not the trailer", () => {
		assert.equal(parseMeasurementTrailer("Refs #561"), null);
	});

	it("parses an in-sample record with counts", () => {
		const r = parseMeasurementTrailer("Review-Measurement: sample=in new=2 adopted=1");
		assert.equal(r.sample, "in");
		assert.equal(r.new, 2);
		assert.equal(r.adopted, 1);
	});

	it("parses a zero-finding record, which is the denominator the rate depends on", () => {
		const r = parseMeasurementTrailer("Review-Measurement: sample=in new=0 adopted=0");
		assert.equal(r.sample, "in");
		assert.equal(r.new, 0);
		assert.equal(r.error, undefined);
	});

	it("parses a quoted angles field containing spaces and semicolons", () => {
		const r = parseMeasurementTrailer('Review-Measurement: sample=in new=0 adopted=0 angles="branch coverage; error paths"');
		assert.equal(r.angles, "branch coverage; error paths");
	});

	it("accepts an out-of-sample record without counts", () => {
		const r = parseMeasurementTrailer("Review-Measurement: sample=out");
		assert.equal(r.sample, "out");
		assert.equal(r.error, undefined);
	});

	it("rejects an unknown sample value", () => {
		const r = parseMeasurementTrailer("Review-Measurement: sample=maybe new=0 adopted=0");
		assert.match(r.error, /sample/);
	});

	it("rejects an in-sample record missing the new count", () => {
		const r = parseMeasurementTrailer("Review-Measurement: sample=in adopted=0");
		assert.match(r.error, /new/);
	});

	it("rejects adopted exceeding new, which cannot happen by definition", () => {
		const r = parseMeasurementTrailer("Review-Measurement: sample=in new=1 adopted=3");
		assert.match(r.error, /adopted/);
	});
});

describe("extractMeasurements", () => {
	it("finds the trailer anywhere in a multi-line commit body", () => {
		const body = "feat: something\n\nBody text.\n\nReview-Measurement: sample=in new=1 adopted=1\nRefs #561\n";
		const found = extractMeasurements(log(["abc1234", body]));
		assert.equal(found.length, 1);
		assert.equal(found[0].sha, "abc1234");
		assert.equal(found[0].new, 1);
	});

	it("returns nothing for commits without the trailer", () => {
		assert.deepEqual(extractMeasurements(log(["abc1234", "docs: no trailer here\n"])), []);
	});

	it("keeps one record per commit across several commits", () => {
		const found = extractMeasurements(
			log(
				["aaa", "x\n\nReview-Measurement: sample=in new=0 adopted=0\n"],
				["bbb", "y\n\nReview-Measurement: sample=out\n"],
				["ccc", "z\n"],
			),
		);
		assert.deepEqual(
			found.map((r) => [r.sha, r.sample]),
			[
				["aaa", "in"],
				["bbb", "out"],
			],
		);
	});
});

describe("IN_SAMPLE_PATH", () => {
	it("matches the code paths that put a cycle in sample", () => {
		assert.equal(IN_SAMPLE_PATH.test("scripts/lib/review-measurement.mjs\n"), true);
		assert.equal(IN_SAMPLE_PATH.test("packages/core/src/parser.ts\n"), true);
	});

	it("does not match prose-only changes, which stay out of sample", () => {
		assert.equal(IN_SAMPLE_PATH.test(".pfdsl/roadmap.md\ndocs/adr/README.md\n"), false);
	});

	it("matches when a code path appears on any line of a file list", () => {
		assert.equal(IN_SAMPLE_PATH.test("docs/adr/README.md\nscripts/gate-check.mjs\n"), true);
	});
});

describe("summarize", () => {
	it("counts only in-sample records toward the target", () => {
		const s = summarize([
			{ sample: "in", new: 0, adopted: 0 },
			{ sample: "out" },
			{ sample: "in", new: 2, adopted: 1 },
		]);
		assert.equal(s.sampled, 2);
		assert.equal(s.outOfSample, 1);
		assert.equal(s.remaining, TARGET_SAMPLE_COUNT - 2);
	});

	it("reports the finding rate over in-sample cycles, not over all cycles", () => {
		const s = summarize([
			{ sample: "in", new: 0, adopted: 0 },
			{ sample: "in", new: 3, adopted: 2 },
			{ sample: "out" },
		]);
		assert.equal(s.cyclesWithFindings, 1);
		assert.equal(s.totalNew, 3);
		assert.equal(s.totalAdopted, 2);
		assert.equal(s.findingRate, 0.5);
	});

	it("reports a null rate rather than dividing by zero when nothing is sampled yet", () => {
		const s = summarize([{ sample: "out" }]);
		assert.equal(s.sampled, 0);
		assert.equal(s.findingRate, null);
	});

	it("separates malformed records so they cannot silently count as zero-finding cycles", () => {
		const s = summarize([
			{ sample: "in", new: 0, adopted: 0 },
			{ sample: "in", error: "missing new" },
		]);
		assert.equal(s.sampled, 1);
		assert.equal(s.malformed, 1);
	});
});

describe("parseSinceArg", () => {
	it("returns no ref when the flag is absent", () => {
		assert.deepEqual(parseSinceArg([]), { since: undefined });
	});

	it("reads the separate-argument form", () => {
		assert.deepEqual(parseSinceArg(["--since", "v1.0"]), { since: "v1.0" });
	});

	it("reads the inline form, which otherwise looks like an unknown flag", () => {
		assert.deepEqual(parseSinceArg(["--since=v1.0"]), { since: "v1.0" });
	});

	it("errors when the flag carries no ref rather than dropping the scan", () => {
		assert.match(parseSinceArg(["--since"]).error, /--since/);
	});

	it("errors when the next argument is another flag, not a ref", () => {
		assert.match(parseSinceArg(["--since", "--verbose"]).error, /--since/);
	});

	it("errors on an empty inline value", () => {
		assert.match(parseSinceArg(["--since="]).error, /--since/);
	});
});
