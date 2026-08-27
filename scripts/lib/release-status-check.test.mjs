import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	compareVersions,
	formatAssetSweepStatus,
	formatDistributionReviewStatus,
	formatFullReviewStatus,
	formatResults,
	formatSkillBundleStatus,
	formatSpecHistoryStatus,
	latestFullReviewDate,
	needsAction,
} from "./release-status-check.mjs";

describe("compareVersions", () => {
	it("equal when versions match", () => {
		assert.equal(compareVersions("1.2.3", "1.2.3"), "equal");
		assert.equal(compareVersions("0.0.6", "0.0.6"), "equal");
	});

	it("local-ahead when local > published (patch)", () => {
		assert.equal(compareVersions("1.2.4", "1.2.3"), "local-ahead");
	});

	it("local-ahead when local > published (minor)", () => {
		assert.equal(compareVersions("1.3.0", "1.2.9"), "local-ahead");
	});

	it("local-ahead when local > published (major)", () => {
		assert.equal(compareVersions("2.0.0", "1.9.9"), "local-ahead");
	});

	it("published-ahead when published > local", () => {
		assert.equal(compareVersions("1.2.3", "1.2.4"), "published-ahead");
	});
});

describe("formatResults", () => {
	it("shows up-to-date for equal versions", () => {
		const results = [
			{
				name: "@pfdsl/cli",
				registry: "npm",
				localVersion: "0.0.6",
				publishedVersion: "0.0.6",
				status: "equal",
			},
		];
		const out = formatResults(results);
		assert.match(out, /@pfdsl\/cli/);
		assert.match(out, /0\.0\.6/);
		assert.match(out, /up-to-date/);
	});

	it("shows behind for local-ahead", () => {
		const results = [
			{
				name: "@pfdsl/cli",
				registry: "npm",
				localVersion: "0.0.7",
				publishedVersion: "0.0.6",
				status: "local-ahead",
			},
		];
		const out = formatResults(results);
		assert.match(out, /behind/);
		assert.match(out, /0\.0\.7/);
		assert.match(out, /0\.0\.6/);
	});

	it("shows error for error status", () => {
		const results = [
			{
				name: "takasek.pfdsl",
				registry: "vscode-marketplace",
				localVersion: "0.0.10",
				publishedVersion: "error: fetch failed",
				status: "error",
			},
		];
		const out = formatResults(results);
		assert.match(out, /error/);
	});

	it("aligns multiple results", () => {
		const results = [
			{
				name: "@pfdsl/cli",
				registry: "npm",
				localVersion: "0.0.6",
				publishedVersion: "0.0.6",
				status: "equal",
			},
			{
				name: "takasek.pfdsl",
				registry: "vscode-marketplace",
				localVersion: "0.0.11",
				publishedVersion: "0.0.10",
				status: "local-ahead",
			},
		];
		const out = formatResults(results);
		assert.match(out, /@pfdsl\/cli/);
		assert.match(out, /takasek\.pfdsl/);
		assert.match(out, /up-to-date/);
		assert.match(out, /behind/);
	});

	it("shows commits-ahead warning when version is equal but commits exist", () => {
		const results = [
			{
				name: "@pfdsl/cli",
				registry: "npm",
				localVersion: "0.0.7",
				publishedVersion: "0.0.7",
				status: "equal",
				commitsAhead: 2,
			},
		];
		const out = formatResults(results);
		assert.match(out, /commits-ahead/);
		assert.match(out, /2 commit/);
		assert.match(out, /needs version bump/);
	});

	it("shows up-to-date when version is equal and no commits ahead", () => {
		const results = [
			{
				name: "@pfdsl/cli",
				registry: "npm",
				localVersion: "0.0.7",
				publishedVersion: "0.0.7",
				status: "equal",
				commitsAhead: 0,
			},
		];
		const out = formatResults(results);
		assert.match(out, /up-to-date/);
	});
});

describe("formatSkillBundleStatus", () => {
	it("shows commits-ahead warning with count and tag when commitCount > 0", () => {
		const out = formatSkillBundleStatus(3, "v0.0.17");
		assert.match(out, /commits-ahead/);
		assert.match(out, /3 commit/);
		assert.match(out, /v0\.0\.17/);
		assert.match(out, /needs CLI release/);
	});

	it("shows up-to-date when commitCount is 0", () => {
		const out = formatSkillBundleStatus(0, "v0.0.17");
		assert.match(out, /up-to-date/);
		assert.match(out, /v0\.0\.17/);
		assert.doesNotMatch(out, /commits-ahead/);
	});

	it("shows up-to-date when there is no prior CLI tag yet", () => {
		const out = formatSkillBundleStatus(0, null);
		assert.match(out, /up-to-date/);
	});
});

describe("formatDistributionReviewStatus", () => {
	it("reports how many bundled prompts are past their review", () => {
		const out = formatDistributionReviewStatus({
			record: {
				commit: "abcdef1234567890abcdef1234567890abcdef12",
				date: "2026-08-01",
			},
			unreviewedCount: 3,
		});
		assert.match(out, /3 file/);
		assert.match(out, /abcdef1/);
		assert.match(out, /2026-08-01/);
	});

	it("says the bundle has never been reviewed when there is no record", () => {
		const out = formatDistributionReviewStatus({
			record: { commit: null },
			unreviewedCount: 22,
		});
		assert.match(out, /never reviewed/);
		assert.match(out, /22 file/);
	});

	it("shows current when nothing has moved", () => {
		const out = formatDistributionReviewStatus({
			record: { commit: "a".repeat(40), date: "2026-08-01" },
			unreviewedCount: 0,
		});
		assert.match(out, /✓/);
		assert.doesNotMatch(out, /file\(s\) unreviewed/);
	});
});

describe("formatAssetSweepStatus", () => {
	const target = {
		label: "retro-pattern sweep (.pfdsl/bindings/pfd-retro-patterns)",
		threshold: 20,
	};

	it("shows current when the target's added-file count is under threshold", () => {
		const out = formatAssetSweepStatus([
			{
				target,
				record: { commit: "a".repeat(40), date: "2026-08-01" },
				result: {
					ok: true,
					base: "a".repeat(40),
					files: [],
					unreachable: false,
				},
			},
		]);
		assert.match(out, /✓/);
		assert.match(out, /2026-08-01/);
	});

	it("reports the overdue count and threshold once a target trips", () => {
		const out = formatAssetSweepStatus([
			{
				target,
				record: { commit: "a".repeat(40), date: "2026-08-01" },
				result: {
					ok: false,
					base: "a".repeat(40),
					files: Array.from({ length: 22 }, (_, i) => `p${i}.md`),
					unreachable: false,
				},
			},
		]);
		assert.match(out, /!/);
		assert.match(out, /22/);
		assert.match(out, /20/);
	});

	it("says never swept when there is no record", () => {
		const out = formatAssetSweepStatus([
			{
				target,
				record: null,
				result: {
					ok: false,
					base: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
					files: Array.from({ length: 22 }, (_, i) => `p${i}.md`),
					unreachable: false,
				},
			},
		]);
		assert.match(out, /never/);
	});

	it("says cannot determine when the recorded sweep commit is unreachable", () => {
		const out = formatAssetSweepStatus([
			{
				target,
				record: { commit: "b".repeat(40) },
				result: { ok: false, base: "b".repeat(40), unreachable: true },
			},
		]);
		assert.match(out, /cannot determine/);
	});
});

describe("formatSpecHistoryStatus", () => {
	it("shows current when spec-history.md documents the spec version", () => {
		const out = formatSpecHistoryStatus({
			ok: true,
			message: "docs/spec/spec-history.md documents v0.0.17.",
		});
		assert.match(out, /✓/);
		assert.match(out, /v0\.0\.17/);
	});

	it("flags a missing changelog entry", () => {
		const out = formatSpecHistoryStatus({
			ok: false,
			message:
				"docs/spec/spec.md is at v0.0.18, but docs/spec/spec-history.md has no changelog\nentry mentioning it.",
		});
		assert.match(out, /!/);
		assert.match(out, /v0\.0\.18/);
	});
});

describe("latestFullReviewDate", () => {
	it("takes the newest full-mode log", () => {
		const files = [
			"2026-07-01-full.md",
			"2026-08-01-diff.md",
			"2026-07-20-full.md",
			"reviewed.json",
		];
		assert.equal(latestFullReviewDate(files), "2026-07-20");
	});

	it("is null when no full review has been run", () => {
		assert.equal(latestFullReviewDate(["2026-08-01-diff.md"]), null);
	});
});

describe("formatFullReviewStatus", () => {
	it("names the date of the last full review", () => {
		assert.match(formatFullReviewStatus("2026-07-20"), /2026-07-20/);
	});

	it("says so when a full review has never been run", () => {
		// Manual-only by design, so this line is the whole reminder that it
		// exists — the dormancy ADR-0029 fell into started exactly this way.
		assert.match(formatFullReviewStatus(null), /never run/);
	});
});

describe("needsAction", () => {
	it("is true when a normalized release gate is not current", () => {
		assert.equal(
			needsAction({
				results: [],
				skillBundleCommits: 0,
				gates: [
					{
						id: "asset-sweep",
						ok: false,
						lines: ["The following asset sweeps are overdue:"],
					},
				],
			}),
			true,
		);
	});

	it("is true when a normalized release gate omits its verdict", () => {
		assert.equal(
			needsAction({
				results: [],
				skillBundleCommits: 0,
				gates: [{ id: "future-gate", lines: ["missing verdict"] }],
			}),
			true,
		);
	});

	const current = {
		results: [
			{ name: "@pfdsl/cli", status: "equal", commitsAhead: 0 },
			{ name: "@pfdsl/core", status: "equal", commitsAhead: 0 },
		],
		skillBundleCommits: 0,
		gates: [
			{ id: "distribution-review", ok: true, lines: [] },
			{ id: "asset-sweep", ok: true, lines: [] },
			{ id: "spec-history", ok: true, lines: [] },
		],
	};

	it("is false when every gate reads current", () => {
		assert.equal(needsAction(current), false);
	});

	it("is true when a package version is unpublished", () => {
		assert.equal(
			needsAction({
				...current,
				results: [{ name: "@pfdsl/cli", status: "local-ahead" }],
			}),
			true,
		);
	});

	it("is true when a published version could not be read", () => {
		assert.equal(
			needsAction({
				...current,
				results: [{ name: "@pfdsl/cli", status: "error" }],
			}),
			true,
		);
	});

	it("is true when commits landed since the published version", () => {
		assert.equal(
			needsAction({
				...current,
				results: [{ name: "@pfdsl/cli", status: "equal", commitsAhead: 3 }],
			}),
			true,
		);
	});

	it("is true when the skill bundle moved since the last CLI tag", () => {
		assert.equal(needsAction({ ...current, skillBundleCommits: 2 }), true);
	});

	it("is true when bundled prompts are past their last review", () => {
		// `make release` refuses here (check-distribution-review.mjs), and this
		// gate runs nowhere else — CI is not wired to it.
		assert.equal(
			needsAction({
				...current,
				gates: [{ id: "distribution-review", ok: false, lines: [] }],
			}),
			true,
		);
	});

	it("is true when the review record could not be read at all", () => {
		// unreviewedCount is undefined there; reading that as zero would say
		// current where the release gate refuses.
		assert.equal(
			needsAction({
				...current,
				gates: [{ id: "distribution-review", ok: false, lines: [] }],
			}),
			true,
		);
	});

	it("is true when spec-history does not document the current spec version", () => {
		assert.equal(
			needsAction({
				...current,
				gates: [{ id: "spec-history", ok: false, lines: [] }],
			}),
			true,
		);
	});

	it("is true when a registered asset sweep is overdue", () => {
		// `make release` refuses here (check-asset-sweep.mjs), and this gate
		// runs nowhere else — CI is not wired to it, same as distributionReview.
		assert.equal(
			needsAction({
				...current,
				gates: [{ id: "asset-sweep", ok: false, lines: [] }],
			}),
			true,
		);
	});
});
