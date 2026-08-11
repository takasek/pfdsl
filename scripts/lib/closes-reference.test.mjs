import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyClosesReference } from "./closes-reference.mjs";

describe("classifyClosesReference", () => {
	const intoMain = { baseRef: "main", defaultBranch: "main" };

	it("PASSes when GitHub reads the PR as closing an issue", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 1,
			body: "Closes #476",
		});
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /1/);
	});

	it("FAILs a PR into the default branch that closes nothing", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 0,
			body: "Refs #476",
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /Closes/);
	});

	// The link, not the token: `Closes #476` inside a code fence or a quoted
	// example does not close anything, and GitHub is the one that knows.
	it("trusts GitHub's own reading over the presence of the word", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 0,
			body: "The convention is to write `Closes #<n>` in the body.",
		});
		assert.equal(result.status, "FAIL");
	});

	it("SKIPs an intermediate PR, where the convention forbids the keyword", () => {
		const result = classifyClosesReference({
			baseRef: "feat/parent",
			defaultBranch: "main",
			closingIssueCount: 0,
			body: "",
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /feat\/parent/);
	});

	it("SKIPs a hotfix, which the backend convention exempts from having an issue", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 0,
			body: "hotfix: restore the dropped exit code\n\ndetails",
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /hotfix/);
	});

	it("does not let the word hotfix in prose excuse a missing Closes", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 0,
			body: "This is not a hotfix, it implements the feature.",
		});
		assert.equal(result.status, "FAIL");
	});

	// The companion writes the declaration as `hotfix:` at the head of the
	// description. A line head alone is looser than that, and a PR body
	// explaining the convention starts lines with the bare word.
	it("requires the colon the convention writes, not the bare word", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 0,
			body: "hotfix PRs are the one case that may skip the issue.",
		});
		assert.equal(result.status, "FAIL");
	});

	it("SKIPs a no-issue declaration that gives a reason", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 0,
			body: "no-issue: retro bookkeeping only, nothing to gate\n\ndetails",
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /no-issue/);
	});

	// A reason is required so an empty declaration cannot wave the PR through —
	// unlike `hotfix:`, which names an established convention on its own,
	// `no-issue:` covers arbitrary PRs and needs the reason to be reviewable.
	it("FAILs an empty no-issue declaration", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 0,
			body: "no-issue:\n\ndetails",
		});
		assert.equal(result.status, "FAIL");
	});

	it("FAILs no-issue mentioned mid-line rather than at a line head", () => {
		const result = classifyClosesReference({
			...intoMain,
			closingIssueCount: 0,
			body: "This is not a no-issue: case, it implements the feature.",
		});
		assert.equal(result.status, "FAIL");
	});
});
