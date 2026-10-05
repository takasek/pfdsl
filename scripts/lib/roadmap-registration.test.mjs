import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";

import {
	buildAuditArgs,
	classifyRoadmapRegistration,
	localClosingIssueNumbers,
} from "./roadmap-registration.mjs";

it("runs the registration workflow for a closing PR without a roadmap file change", () => {
	const workflow = parse(
		readFileSync(
			new URL(
				"../../.github/workflows/check-roadmap-registration.yml",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert.equal(workflow.on.pull_request.paths, undefined);
	assert.equal(workflow.on.pull_request["paths-ignore"], undefined);
	assert.ok(workflow.on.pull_request.types.includes("edited"));
});

describe("localClosingIssueNumbers", () => {
	const ref = (number, owner, name) => ({
		number,
		repository: { owner: { login: owner }, name },
	});

	it("keeps only this repository's references before reducing to numbers", () => {
		assert.deepEqual(
			localClosingIssueNumbers(
				[
					ref(12, "other", "pfdsl"),
					ref(12, "takasek", "other"),
					ref(34, "takasek", "pfdsl"),
				],
				{ owner: "takasek", repo: "pfdsl" },
			),
			[34],
		);
	});

	it("matches GitHub names case-insensitively and enforces duplicate links once", () => {
		assert.deepEqual(
			localClosingIssueNumbers(
				[
					ref(12, "TAKASEK", "PFDSL"),
					ref(12, "takasek", "pfdsl"),
					ref(12, "other", "pfdsl"),
				],
				{ owner: "takasek", repo: "pfdsl" },
			),
			[12],
		);
	});

	it("keeps an empty reference set empty", () => {
		assert.deepEqual(
			localClosingIssueNumbers([], { owner: "takasek", repo: "pfdsl" }),
			[],
		);
	});
});

describe("buildAuditArgs", () => {
	it("enforces every issue the PR closes", () => {
		assert.deepEqual(buildAuditArgs([12, 34]), [
			"scripts/pfdsl/audit-issues-flow.mjs",
			"--enforce-issue",
			"12",
			"--enforce-issue",
			"34",
		]);
	});

	it("enforces nothing when the PR closes nothing", () => {
		assert.deepEqual(buildAuditArgs([]), [
			"scripts/pfdsl/audit-issues-flow.mjs",
		]);
	});
});

describe("classifyRoadmapRegistration", () => {
	it("skips when the PR closes no issue: there is nothing this PR can register", () => {
		const r = classifyRoadmapRegistration({ issueNumbers: [], auditExit: 0 });
		assert.equal(r.status, "SKIP");
	});

	it("passes when the audit accepts the tree", () => {
		const r = classifyRoadmapRegistration({ issueNumbers: [12], auditExit: 0 });
		assert.equal(r.status, "PASS");
		// A flow:exempt issue passes by being absent by design, so the wording
		// must not claim the issue was registered.
		assert.doesNotMatch(r.detail, /registered/);
	});

	it("fails when the audit rejects it", () => {
		const r = classifyRoadmapRegistration({ issueNumbers: [12], auditExit: 1 });
		assert.equal(r.status, "FAIL");
		assert.match(r.detail, /12/);
	});

	it("skips on the gh-unavailable exit code rather than reading it as a rejection", () => {
		const r = classifyRoadmapRegistration({ issueNumbers: [12], auditExit: 2 });
		assert.equal(r.status, "SKIP");
		assert.match(r.detail, /GitHub operations unavailable/);
	});
});
