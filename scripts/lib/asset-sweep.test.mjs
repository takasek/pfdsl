import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	formatGateFailure,
	inScope,
	repoDeps,
	runAssetSweepCheck,
	SWEEP_TARGETS,
} from "./asset-sweep.mjs";
import { EMPTY_TREE } from "./review-record-gate.mjs";

const RETRO_TARGET = SWEEP_TARGETS.find((t) => t.id === "retro-patterns");

describe("SWEEP_TARGETS", () => {
	it("registers the retro-patterns catalog", () => {
		assert.ok(RETRO_TARGET, "expected a retro-patterns target");
		assert.equal(
			RETRO_TARGET.recordPath,
			"docs/asset-sweep/retro-patterns.json",
		);
		assert.deepEqual(RETRO_TARGET.prefixes, [
			".pfdsl/bindings/pfd-retro-patterns/",
		]);
		assert.equal(RETRO_TARGET.threshold, 20);
		assert.equal(RETRO_TARGET.skill, "retro-pattern-sweep");
		assert.ok(RETRO_TARGET.label.length > 0);
	});
});

describe("inScope", () => {
	it("takes a markdown file under one of the target's prefixes", () => {
		assert.equal(
			inScope(RETRO_TARGET, ".pfdsl/bindings/pfd-retro-patterns/foo.md"),
			true,
		);
	});

	it("leaves out a file outside every prefix", () => {
		assert.equal(inScope(RETRO_TARGET, ".pfdsl/bindings/pfd-retro.md"), false);
	});

	it("leaves out a non-markdown file under a matching prefix", () => {
		assert.equal(
			inScope(RETRO_TARGET, ".pfdsl/bindings/pfd-retro-patterns/foo.pfdsl"),
			false,
		);
	});
});

describe("runAssetSweepCheck", () => {
	const deps = ({ record, added = [], reachable = true }) => ({
		readRecord: () => record,
		commitExists: () => reachable,
		changedSince: () => added,
	});

	it("passes when a target's added-file count stays under its threshold", () => {
		const result = runAssetSweepCheck(
			deps({
				record: { commit: "a".repeat(40), date: "2026-08-01" },
				added: Array.from(
					{ length: 5 },
					(_, i) => `.pfdsl/bindings/pfd-retro-patterns/p${i}.md`,
				),
			}),
		);
		assert.equal(result.ok, true);
	});

	it("fails, naming the target, once the threshold is reached", () => {
		const result = runAssetSweepCheck(
			deps({
				record: { commit: "a".repeat(40), date: "2026-08-01" },
				added: Array.from(
					{ length: 20 },
					(_, i) => `.pfdsl/bindings/pfd-retro-patterns/p${i}.md`,
				),
			}),
		);
		assert.equal(result.ok, false);
		assert.match(result.message, /retro-pattern sweep/);
		assert.match(result.message, /20/);
		assert.match(result.message, /retro-pattern-sweep/);
	});

	it("fails when no sweep has ever been recorded", () => {
		const result = runAssetSweepCheck(
			deps({
				record: null,
				added: Array.from(
					{ length: 20 },
					(_, i) => `.pfdsl/bindings/pfd-retro-patterns/p${i}.md`,
				),
			}),
		);
		assert.equal(result.ok, false);
		assert.match(result.message, /never/);
	});

	it("asks for a fetch when the recorded sweep commit is not in this clone", () => {
		const result = runAssetSweepCheck(
			deps({ record: { commit: "b".repeat(40) }, reachable: false }),
		);
		assert.equal(result.ok, false);
		assert.match(result.message, /git fetch/);
	});

	it("does not count changed-but-not-added files, since the threshold is additions", () => {
		// deps.changedSince here stands in for a diff already filtered by
		// --diff-filter=A upstream (repoDeps applies that); this test exercises
		// evaluateAssetSweep's own scope filter, not the filter-A wiring.
		const result = runAssetSweepCheck(
			deps({
				record: { commit: "a".repeat(40), date: "2026-08-01" },
				added: [
					".pfdsl/bindings/pfd-retro-patterns/only-one.md",
					"scripts/unrelated.mjs",
				],
			}),
		);
		assert.equal(result.ok, true);
	});
});

describe("formatGateFailure", () => {
	it("names the count, threshold, last sweep, and skill for an overdue target", () => {
		const message = formatGateFailure([
			{
				target: RETRO_TARGET,
				record: {
					commit: "abcdef1234567890abcdef1234567890abcdef12",
					date: "2026-08-01",
				},
				result: {
					ok: false,
					base: "abcdef1234567890abcdef1234567890abcdef12",
					files: Array.from({ length: 22 }, (_, i) => `p${i}.md`),
					unreachable: false,
				},
			},
		]);
		assert.match(message, /22/);
		assert.match(message, /20/);
		assert.match(message, /abcdef1/);
		assert.match(message, /2026-08-01/);
		assert.match(message, /retro-pattern-sweep/);
	});

	it("says never swept when there is no record", () => {
		const message = formatGateFailure([
			{
				target: RETRO_TARGET,
				record: null,
				result: {
					ok: false,
					base: EMPTY_TREE,
					files: Array.from({ length: 22 }, (_, i) => `p${i}.md`),
					unreachable: false,
				},
			},
		]);
		assert.match(message, /never/);
	});

	it("asks for a fetch when the sweep commit is unreachable", () => {
		const message = formatGateFailure([
			{
				target: RETRO_TARGET,
				record: { commit: "b".repeat(40) },
				result: { ok: false, base: "b".repeat(40), unreachable: true },
			},
		]);
		assert.match(message, /git fetch/);
	});
});

describe("repoDeps", () => {
	const captureDiffArgs = (target) => {
		let seen;
		const exec = (args) => {
			seen = args;
			return "";
		};
		repoDeps("/repo", { exec }).changedSince(target, "abc1234");
		return seen;
	};

	it("counts additions, not edits", () => {
		assert.ok(captureDiffArgs(RETRO_TARGET).includes("--diff-filter=A"));
	});

	it("turns rename detection off so a deletion cannot cancel an addition", () => {
		// git pairs a delete with a similar-enough add and reports R, which
		// --diff-filter=A then drops. The catalog's own files share a template,
		// and retiring one pattern while adding another is an ordinary cycle
		// here, so the pairing would silently subtract from the accumulation
		// the threshold exists to measure.
		assert.ok(captureDiffArgs(RETRO_TARGET).includes("--no-renames"));
	});

	it("scopes the diff to the target's own prefixes", () => {
		const args = captureDiffArgs(RETRO_TARGET);
		assert.deepEqual(args.slice(args.indexOf("--") + 1), RETRO_TARGET.prefixes);
	});
});
