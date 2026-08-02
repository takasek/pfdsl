import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	compareVersions,
	formatResults,
	formatSkillBundleStatus,
	formatDistributionReviewStatus,
	formatSpecHistoryStatus,
	latestFullReviewDate,
	formatFullReviewStatus,
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
			record: { commit: "abcdef1234567890abcdef1234567890abcdef12", date: "2026-08-01" },
			unreviewedCount: 3,
		});
		assert.match(out, /3 file/);
		assert.match(out, /abcdef1/);
		assert.match(out, /2026-08-01/);
	});

	it("says the bundle has never been reviewed when there is no record", () => {
		const out = formatDistributionReviewStatus({ record: { commit: null }, unreviewedCount: 22 });
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
		const out = formatSpecHistoryStatus({ ok: true, message: "docs/spec/spec-history.md documents v0.0.17." });
		assert.match(out, /✓/);
		assert.match(out, /v0\.0\.17/);
	});

	it("flags a missing changelog entry", () => {
		const out = formatSpecHistoryStatus({
			ok: false,
			message: "docs/spec/spec.md is at v0.0.18, but docs/spec/spec-history.md has no changelog\nentry mentioning it.",
		});
		assert.match(out, /!/);
		assert.match(out, /v0\.0\.18/);
	});
});

describe("latestFullReviewDate", () => {
	it("takes the newest full-mode log", () => {
		const files = ["2026-07-01-full.md", "2026-08-01-diff.md", "2026-07-20-full.md", "reviewed.json"];
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
