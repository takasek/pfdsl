import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";
import {
	batchBranchName,
	batchEntries,
	createFinalPr,
	isOwnBatchPull,
	selectBatch,
	updateWorkflowPinExpectations,
	validateDependencyPrFiles,
} from "./dependabot-actions-batch.mjs";

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
	it("collects the current heads after the queue has settled", () => {
		const result = selectBatch(
			[pr(10), pr(11, { created_at: "2026-09-28T09:30:00Z" })],
			{ repository: "takasek/pfdsl" },
		);
		assert.equal(result.status, "ready");
		assert.deepEqual(
			result.pulls.map((p) => p.number),
			[10, 11],
		);
	});

	it("does not lose a PR after its update timestamp changes", () => {
		const result = selectBatch(
			[pr(10, { updated_at: "2026-09-28T09:59:00Z" })],
			{
				repository: "takasek/pfdsl",
			},
		);
		assert.equal(result.status, "ready");
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
			{ repository: "takasek/pfdsl" },
		);
		assert.equal(result.status, "ready");
		assert.deepEqual(
			result.pulls.map((p) => p.number),
			[10, 16],
		);
		assert.match(
			batchBranchName(result.pulls),
			/^automation\/dependabot-actions-10-16-[0-9a-f]{12}$/,
		);
	});

	it("returns empty when there is no eligible PR", () => {
		assert.equal(
			selectBatch([pr(10, { state: "closed" })], {
				repository: "takasek/pfdsl",
			}).status,
			"empty",
		);
	});

	it("excludes only the exact head delivered by a merged batch", () => {
		const result = selectBatch(
			[
				pr(10),
				pr(11),
				pr(12, { head: { ...pr(12).head, sha: "a".repeat(40) } }),
			],
			{
				repository: "takasek/pfdsl",
				excludedHeads: new Set([
					`10@${pr(10).head.sha}`,
					`12@${pr(12).head.sha}`,
				]),
			},
		);
		assert.deepEqual(
			result.pulls.map((p) => p.number),
			[11, 12],
		);
		assert.notEqual(
			batchBranchName([pr(10)]),
			batchBranchName([
				pr(10, { head: { ...pr(10).head, sha: "a".repeat(40) } }),
			]),
		);
	});

	it("reads the durable PR membership marker", () => {
		assert.deepEqual(
			batchEntries(
				`no-issue: upkeep\n\nbatch-includes: 10@${pr(10).head.sha},11@${pr(11).head.sha}`,
			),
			[
				{ number: 10, sha: pr(10).head.sha },
				{ number: 11, sha: pr(11).head.sha },
			],
		);
		assert.deepEqual(batchEntries("unrelated PR"), []);
	});

	it("recognizes only a batch branch from this repository", () => {
		const ref = batchBranchName([pr(10), pr(11)]);
		assert.equal(
			isOwnBatchPull(
				{
					head: {
						ref,
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
						ref,
						repo: { full_name: "takasek/pfdsl" },
					},
				},
				"takasek/pfdsl",
			),
			true,
		);
		assert.equal(
			isOwnBatchPull(
				{
					head: {
						ref: "codex/dependabot-actions-batch",
						repo: { full_name: "takasek/pfdsl" },
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
						ref: "automation/dependabot-actions-10-11",
						repo: { full_name: "takasek/pfdsl" },
					},
				},
				"takasek/pfdsl",
			),
			false,
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
	it("debounces bot PRs in an unprivileged workflow, then uses workflow_run for secrets", () => {
		const queueSource = readFileSync(
			new URL(
				"../.github/workflows/dependabot-actions-batch.yml",
				import.meta.url,
			),
			"utf8",
		);
		const queue = parse(queueSource);
		const integrate = parse(
			readFileSync(
				new URL(
					"../.github/workflows/dependabot-actions-integrate.yml",
					import.meta.url,
				),
				"utf8",
			),
		);
		assert.deepEqual(queue.on.pull_request_target.types, [
			"opened",
			"reopened",
			"labeled",
		]);
		assert.equal(queue.on.schedule, undefined);
		assert.equal(queue.jobs.settle.concurrency["cancel-in-progress"], true);
		assert.doesNotMatch(queue.jobs.settle.if, /closed|dependabot-actions-/);
		assert.equal(queue.jobs.integrate, undefined);
		assert.doesNotMatch(queueSource, /secrets\./);
		assert.deepEqual(integrate.on.workflow_run.workflows, [queue.name]);
		assert.deepEqual(integrate.on.workflow_run.types, ["completed"]);
		assert.equal(integrate.on.workflow_dispatch, null);
		assert.match(integrate.jobs.integrate.if, /workflow_dispatch/);
		assert.match(integrate.jobs.integrate.if, /conclusion == 'success'/);
		assert.equal(
			integrate.jobs.integrate.concurrency["cancel-in-progress"],
			false,
		);
		assert.equal(integrate.permissions.actions, "read");
		const steps = integrate.jobs.integrate.steps;
		const proof = steps.findIndex(
			(step) => step.name === "Verify the settle job completed",
		);
		const token = steps.findIndex((step) => step.id === "app-token");
		assert.ok(proof >= 0 && proof < token);
		assert.equal(steps[proof].if, "github.event_name == 'workflow_run'");
		assert.match(steps[proof].run, /conclusion == "success"/);
	});
});

describe("final PR publication", () => {
	it("retries creation even when the existence check also fails", () => {
		let attempts = 0;
		let waits = 0;
		let body;
		createFinalPr(batchBranchName([pr(10)]), [pr(10)], {
			execute: (_file, args) => {
				attempts++;
				if (attempts < 3) throw new Error("temporary network failure");
				body = args[args.indexOf("--body") + 1];
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
		assert.match(
			body,
			new RegExp(`^batch-includes: 10@${pr(10).head.sha}$`, "m"),
		);
		assert.match(body, /merge commit/);
	});
});
