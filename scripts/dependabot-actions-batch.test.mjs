import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";
import {
	batchBranchName,
	batchNumbers,
	createFinalPr,
	isOwnBatchPull,
	selectBatch,
	updateWorkflowPinExpectations,
	validateDependencyPrFiles,
} from "./dependabot-actions-batch.mjs";

const now = Date.parse("2026-09-28T10:00:00Z");
const pr = (number, overrides = {}) => ({
	number,
	state: "open",
	draft: false,
	user: { login: "dependabot[bot]" },
	base: { ref: "main" },
	head: {
		ref: `dependabot/github_actions/action-${number}`,
		sha: `${number}`.padStart(40, "0"),
		repo: { full_name: "takasek/pfdsl" },
	},
	created_at: "2026-09-28T08:00:00Z",
	...overrides,
});

describe("Dependabot Actions batch selection", () => {
	it("waits until every candidate is older than the quiet period", () => {
		const result = selectBatch(
			[pr(10), pr(11, { created_at: "2026-09-28T09:30:00Z" })],
			{ now, repository: "takasek/pfdsl", quietMinutes: 45 },
		);
		assert.equal(result.status, "waiting");
		assert.deepEqual(
			result.pulls.map((p) => p.number),
			[10, 11],
		);
	});

	it("collects only open first-party Dependabot GitHub Actions PRs", () => {
		const result = selectBatch(
			[
				pr(10),
				pr(11, { user: { login: "someone" } }),
				pr(12, { base: { ref: "other" } }),
				pr(13, {
					head: {
						ref: "dependabot/npm/foo",
						sha: "a".repeat(40),
						repo: { full_name: "takasek/pfdsl" },
					},
				}),
				pr(14, { draft: true }),
				pr(15, {
					head: {
						ref: "dependabot/github_actions/foo",
						sha: "b".repeat(40),
						repo: { full_name: "foreign/pfdsl" },
					},
				}),
				pr(16),
			],
			{ now, repository: "takasek/pfdsl", quietMinutes: 45 },
		);
		assert.equal(result.status, "ready");
		assert.deepEqual(
			result.pulls.map((p) => p.number),
			[10, 16],
		);
		assert.equal(
			batchBranchName(result.pulls),
			"codex/dependabot-actions-10-16",
		);
	});

	it("returns empty when there is no eligible PR", () => {
		assert.equal(
			selectBatch([pr(10, { state: "closed" })], {
				now,
				repository: "takasek/pfdsl",
				quietMinutes: 45,
			}).status,
			"empty",
		);
	});

	it("excludes PRs already delivered by a merged batch", () => {
		const result = selectBatch([pr(10), pr(11)], {
			now,
			repository: "takasek/pfdsl",
			quietMinutes: 15,
			excludedNumbers: new Set([10]),
		});
		assert.deepEqual(
			result.pulls.map((p) => p.number),
			[11],
		);
	});

	it("reads the durable PR membership marker", () => {
		assert.deepEqual(
			batchNumbers("no-issue: upkeep\n\nbatch-includes: 10,11"),
			[10, 11],
		);
		assert.deepEqual(batchNumbers("unrelated PR"), []);
	});

	it("does not trust a fork PR with the batch branch name", () => {
		assert.equal(
			isOwnBatchPull(
				{
					head: {
						ref: "codex/dependabot-actions-10-11",
						repo: { full_name: "other/pfdsl" },
					},
				},
				"takasek/pfdsl",
			),
			false,
		);
		assert.equal(
			isOwnBatchPull(
				{
					head: {
						ref: "codex/dependabot-actions-10-11",
						repo: { full_name: "takasek/pfdsl" },
					},
				},
				"takasek/pfdsl",
			),
			true,
		);
	});
});

const oldSha = "a".repeat(40);
const newSha = "b".repeat(40);

describe("Dependabot PR boundary", () => {
	it("accepts only action SHA and comment replacements in workflow files", () => {
		assert.doesNotThrow(() =>
			validateDependencyPrFiles([
				{
					filename: ".github/workflows/test.yml",
					status: "modified",
					patch: `@@ -1 +1 @@\n-      - uses: actions/checkout@${oldSha} # v6\n+      - uses: actions/checkout@${newSha} # v7`,
				},
			]),
		);
	});

	it("rejects script changes and non-pin workflow edits", () => {
		assert.throws(() =>
			validateDependencyPrFiles([
				{
					filename: "scripts/build.mjs",
					status: "modified",
					patch: "@@ -1 +1 @@\n-old\n+new",
				},
			]),
		);
		assert.throws(() =>
			validateDependencyPrFiles([
				{
					filename: ".github/workflows/test.yml",
					status: "modified",
					patch:
						"@@ -1 +1 @@\n-      - run: echo safe\n+      - run: echo changed",
				},
			]),
		);
	});

	it("rejects missing patches and shortened action refs", () => {
		assert.throws(() =>
			validateDependencyPrFiles([
				{ filename: ".github/workflows/test.yml", status: "modified" },
			]),
		);
		assert.throws(() =>
			validateDependencyPrFiles([
				{
					filename: ".github/workflows/test.yml",
					status: "modified",
					patch:
						"@@ -1 +1 @@\n-      - uses: actions/checkout@v6\n+      - uses: actions/checkout@v7",
				},
			]),
		);
	});

	it("rejects API patches truncated before all changes", () => {
		assert.throws(() =>
			validateDependencyPrFiles([
				{
					filename: ".github/workflows/test.yml",
					status: "modified",
					additions: 2,
					deletions: 2,
					patch: `@@ -1 +1 @@\n-      - uses: actions/checkout@${oldSha} # v6\n+      - uses: actions/checkout@${newSha} # v7`,
				},
			]),
		);
	});

	it("rejects moving an action between diff hunks", () => {
		assert.throws(() =>
			validateDependencyPrFiles([
				{
					filename: ".github/workflows/test.yml",
					status: "modified",
					additions: 1,
					deletions: 1,
					patch: `@@ -1 +1,0 @@\n-      - uses: actions/checkout@${oldSha} # v6\n@@ -20,0 +20 @@\n+      - uses: actions/checkout@${newSha} # v7`,
				},
			]),
		);
	});
});

describe("workflow pin expectation repair", () => {
	it("updates repeated checkout and setup-node SHA assertions", () => {
		const source = `"actions/checkout@${oldSha}"\n"actions/setup-node@${oldSha}"\n"actions/checkout@${oldSha}"`;
		const result = updateWorkflowPinExpectations(source, {
			"actions/checkout": newSha,
			"actions/setup-node": newSha,
		});
		assert.equal(result.match(new RegExp(newSha, "g")).length, 3);
		assert.doesNotMatch(result, new RegExp(oldSha));
	});

	it("fails when the expected assertion is absent", () => {
		assert.throws(() =>
			updateWorkflowPinExpectations("no action assertions", {
				"actions/checkout": newSha,
			}),
		);
	});
});

describe("passive workflow trigger", () => {
	it("debounces PR events without canceling an active integration", () => {
		const workflow = parse(
			readFileSync(
				new URL(
					"../.github/workflows/dependabot-actions-batch.yml",
					import.meta.url,
				),
				"utf8",
			),
		);
		assert.deepEqual(workflow.on.pull_request_target.types, [
			"opened",
			"reopened",
			"labeled",
			"closed",
		]);
		assert.equal(workflow.on.schedule, undefined);
		assert.equal(workflow.jobs.settle.concurrency["cancel-in-progress"], true);
		assert.equal(
			workflow.jobs.integrate.concurrency["cancel-in-progress"],
			false,
		);
		assert.equal(workflow.jobs.integrate.needs, "settle");
	});
});

describe("final PR publication", () => {
	it("retries creation even when the existence check also fails", () => {
		let attempts = 0;
		let waits = 0;
		createFinalPr("codex/dependabot-actions-10-10", [10], {
			execute: () => {
				attempts++;
				if (attempts < 3) throw new Error("temporary network failure");
			},
			query: () => {
				throw new Error("temporary network failure");
			},
			wait: () => {
				waits++;
			},
		});
		assert.equal(attempts, 3);
		assert.equal(waits, 2);
	});
});
