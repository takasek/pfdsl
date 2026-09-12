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

const PROSE_TARGET = SWEEP_TARGETS.find((t) => t.id === "prose-mechanization");

describe("SWEEP_TARGETS", () => {
	it("registers the prose-mechanization audit against the mechanism ledger", () => {
		assert.ok(PROSE_TARGET, "expected a prose-mechanization target");
		assert.equal(
			PROSE_TARGET.recordPath,
			"docs/asset-sweep/prose-mechanization.json",
		);
		assert.deepEqual(PROSE_TARGET.prefixes, ["scripts/", "hooks/"]);
		assert.equal(PROSE_TARGET.threshold, 20);
		assert.equal(PROSE_TARGET.skill, "prose-mechanization-audit");
		assert.ok(PROSE_TARGET.label.length > 0);
	});

	it("gives every target its own record file", () => {
		const paths = SWEEP_TARGETS.map((t) => t.recordPath);
		assert.equal(
			new Set(paths).size,
			paths.length,
			"a shared record would let one target's sweep claim currency for another",
		);
	});
});

describe("inScope", () => {
	it("leaves historical cases outside the maintained audit scope", () => {
		assert.equal(
			inScope(PROSE_TARGET, ".pfdsl/bindings/pfd-retro-patterns/case.md"),
			false,
		);
	});

	it("takes an entry-point script under either of the prose target's prefixes", () => {
		assert.equal(inScope(PROSE_TARGET, "scripts/check-thing.mjs"), true);
		assert.equal(inScope(PROSE_TARGET, "hooks/on-done.mjs"), true);
	});

	it("leaves out a helper nested below the prefix, which adds no mechanism", () => {
		assert.equal(inScope(PROSE_TARGET, "scripts/lib/thing.mjs"), false);
	});

	it("leaves out a test file, which adds no mechanism", () => {
		assert.equal(inScope(PROSE_TARGET, "scripts/thing.test.mjs"), false);
	});

	it("leaves out a non-script file under a matching prefix", () => {
		assert.equal(inScope(PROSE_TARGET, "scripts/pre-commit"), false);
		assert.equal(inScope(PROSE_TARGET, "hooks/hooks.json"), false);
	});

	it("matches against the path below the prefix, not the whole path", () => {
		// A target whose prefix is nested would otherwise have to repeat that
		// prefix inside its own pattern to anchor it.
		assert.equal(
			inScope({ prefixes: ["a/b/"], matches: /^[^/]+\.md$/ }, "a/b/c.md"),
			true,
		);
		assert.equal(
			inScope({ prefixes: ["a/b/"], matches: /^[^/]+\.md$/ }, "a/b/c/d.md"),
			false,
		);
	});

	it("keeps every registered target's pattern stateless across calls", () => {
		// A /g or /y pattern carries lastIndex between test() calls, so the
		// same path would answer differently on the second ask.
		for (const target of SWEEP_TARGETS) {
			assert.equal(target.matches.global, false, `${target.id} pattern is /g`);
			assert.equal(target.matches.sticky, false, `${target.id} pattern is /y`);
		}
	});
});

describe("runAssetSweepCheck", () => {
	it("does not require historical case freshness to release", () => {
		const reads = [];
		const result = runAssetSweepCheck({
			readRecord: (target) => {
				reads.push(target.id);
				return target.id === "retro-patterns"
					? null
					: { commit: "a".repeat(40), date: "2026-08-01" };
			},
			commitExists: () => true,
			changedSince: () =>
				Array.from(
					{ length: 100 },
					(_, i) => `.pfdsl/bindings/pfd-retro-patterns/case-${i}.md`,
				),
		});
		assert.equal(result.ok, true);
		assert.deepEqual(reads, ["prose-mechanization"]);
	});

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
					(_, i) => `scripts/mechanism-${i}.mjs`,
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
					(_, i) => `scripts/mechanism-${i}.mjs`,
				),
			}),
		);
		assert.equal(result.ok, false);
		assert.match(result.message, /prose-mechanization audit/);
		assert.match(result.message, /20/);
		assert.match(result.message, /prose-mechanization-audit/);
	});

	it("fails when no sweep has ever been recorded", () => {
		const result = runAssetSweepCheck(
			deps({
				record: null,
				added: Array.from(
					{ length: 20 },
					(_, i) => `scripts/mechanism-${i}.mjs`,
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
				added: ["scripts/only-one.mjs", "scripts/lib/unrelated.mjs"],
			}),
		);
		assert.equal(result.ok, true);
	});
});

describe("formatGateFailure", () => {
	it("names the count, threshold, last sweep, and skill for an overdue target", () => {
		const message = formatGateFailure([
			{
				target: PROSE_TARGET,
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
		assert.match(message, /prose-mechanization-audit/);
	});

	it("says never swept when there is no record", () => {
		const message = formatGateFailure([
			{
				target: PROSE_TARGET,
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
				target: PROSE_TARGET,
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
		assert.ok(captureDiffArgs(PROSE_TARGET).includes("--diff-filter=A"));
	});

	it("turns rename detection off so a deletion cannot cancel an addition", () => {
		// Similar entry points must not cancel each other's additions.
		assert.ok(captureDiffArgs(PROSE_TARGET).includes("--no-renames"));
	});

	it("scopes the diff to the target's own prefixes", () => {
		const args = captureDiffArgs(PROSE_TARGET);
		assert.deepEqual(args.slice(args.indexOf("--") + 1), PROSE_TARGET.prefixes);
	});
});
