import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, formatResults } from "./release-status-check.mjs";

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
