import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { classifyClosesReference } from "./closes-reference.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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

// The verdict is derived from the PR body, which lives on GitHub rather than in
// the tree (#936). `pull_request` without `types:` defaults to opened /
// synchronize / reopened — none of which fire when the body is edited, so the
// very fix this check asks for leaves the red in place until someone re-runs
// the job by hand. Naming `types:` at all opts out of that default, so the
// three defaults have to be listed back explicitly or a push stops re-running
// the check.
describe("check-closes-reference workflow trigger", () => {
	// Containment, not equality: the property under test is that these four
	// types are present, and a later trigger this check has no opinion on
	// (`ready_for_review`, say) should not fail here.
	it("re-runs on a body edit as well as on every default trigger", () => {
		const workflow = parse(
			readFileSync(
				resolve(root, ".github/workflows/check-closes-reference.yml"),
				"utf8",
			),
		);
		const types = workflow.on.pull_request?.types ?? [];
		for (const type of ["edited", "opened", "synchronize", "reopened"]) {
			assert.ok(
				types.includes(type),
				`expected the workflow to trigger on \`${type}\`, got ${JSON.stringify(types)}`,
			);
		}
	});
});
