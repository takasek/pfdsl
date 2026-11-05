import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	compareVersions,
	formatDistributionReviewStatus,
	formatFullReviewStatus,
	formatPluginBundleStatus,
	formatResults,
	formatSpecHistoryStatus,
	latestFullReviewDate,
	needsAction,
	readPluginBundleStatus,
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

describe("formatPluginBundleStatus", () => {
	it("reports changed plugin output files rather than an npm skill bundle", () => {
		const out = formatPluginBundleStatus({ changedFiles: 3 }, "v0.0.17");
		assert.match(out, /plugin bundle/);
		assert.match(out, /3 file/);
		assert.match(out, /v0\.0\.17/);
		assert.match(out, /needs plugin release/);
		assert.doesNotMatch(out, /@pfdsl\/cli|\.claude\/skills/);
	});

	it("shows up-to-date when commitCount is 0", () => {
		const out = formatPluginBundleStatus({ changedFiles: 0 }, "v0.0.17");
		assert.match(out, /up-to-date/);
		assert.match(out, /v0\.0\.17/);
		assert.doesNotMatch(out, /commits-ahead/);
	});

	it("reports unknown when no release tag or comparison is available", () => {
		const out = formatPluginBundleStatus(
			{ changedFiles: null, error: "no release tag" },
			null,
		);
		assert.match(out, /unknown.*no release tag/);
		assert.doesNotMatch(out, /up-to-date/);
	});
});

describe("readPluginBundleStatus", () => {
	it("compares both distributed output roots at tag and HEAD endpoints", () => {
		const result = readPluginBundleStatus((args) => {
			assert.deepEqual(args, [
				"diff",
				"--name-only",
				"-z",
				"v0.1.0",
				"HEAD",
				"--",
				"plugin/pfdsl",
				"plugin/pfdsl-codex",
			]);
			return "plugin/pfdsl/hooks/new.mjs\0plugin/pfdsl-codex/skills/pfd-grill/SKILL.md\0";
		}, "v0.1.0");
		assert.equal(result.changedFiles, 2);
	});
	it("treats identical endpoints as current even if intervening commits changed and reverted files", () => {
		assert.equal(readPluginBundleStatus(() => "", "v0.1.0").changedFiles, 0);
	});
	it("preserves missing-tag and Git failures as unknown", () => {
		assert.equal(
			readPluginBundleStatus(() => {
				throw new Error("must not run");
			}, null).changedFiles,
			null,
		);
		const result = readPluginBundleStatus(() => {
			throw new Error("bad ref");
		}, "v0.1.0");
		assert.equal(result.changedFiles, null);
		assert.match(result.error, /bad ref/);
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
				pluginChangedFiles: 0,
				gates: [
					{
						id: "distribution-review",
						ok: false,
						lines: ["The distributed prompts have changed since review."],
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
				pluginChangedFiles: 0,
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
		pluginChangedFiles: 0,
		gates: [
			{ id: "distribution-review", ok: true, lines: [] },
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

	it("is true when plugin output moved since the last release tag or comparison is unknown", () => {
		assert.equal(needsAction({ ...current, pluginChangedFiles: 2 }), true);
		assert.equal(needsAction({ ...current, pluginChangedFiles: null }), true);
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
});
