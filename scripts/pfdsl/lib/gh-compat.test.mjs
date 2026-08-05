import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isGhUnavailableError, planGhRestCall } from "./gh-compat.mjs";

describe("isGhUnavailableError", () => {
	it("true for ENOENT (gh binary missing)", () => {
		const error = Object.assign(new Error("spawnSync gh ENOENT"), {
			code: "ENOENT",
		});
		assert.equal(isGhUnavailableError(error), true);
	});

	it("false for a real gh error (e.g. auth failure)", () => {
		const error = Object.assign(new Error("gh: not logged in"), { code: 1 });
		assert.equal(isGhUnavailableError(error), false);
	});

	it("false for an error with no code", () => {
		assert.equal(isGhUnavailableError(new Error("boom")), false);
	});
});

describe("planGhRestCall", () => {
	it("label list", () => {
		assert.deepEqual(
			planGhRestCall([
				"label",
				"list",
				"--json",
				"name,description",
				"--limit",
				"100",
			]),
			{
				op: "listLabels",
			},
		);
	});

	it("label create", () => {
		const result = planGhRestCall([
			"label",
			"create",
			"flow:managed",
			"--description",
			"tracked",
			"--color",
			"ededed",
		]);
		assert.deepEqual(result, {
			op: "createLabel",
			name: "flow:managed",
			description: "tracked",
			color: "ededed",
		});
	});

	it("label edit", () => {
		const result = planGhRestCall([
			"label",
			"edit",
			"flow:managed",
			"--description",
			"tracked",
		]);
		assert.deepEqual(result, {
			op: "editLabel",
			name: "flow:managed",
			description: "tracked",
		});
	});

	it("issue list", () => {
		const result = planGhRestCall([
			"issue",
			"list",
			"--state",
			"all",
			"--json",
			"number,state,stateReason,labels,updatedAt",
			"--limit",
			"500",
		]);
		assert.deepEqual(result, { op: "listIssues" });
	});

	it("issue edit --add-label", () => {
		const result = planGhRestCall([
			"issue",
			"edit",
			"123",
			"--add-label",
			"flow:managed",
		]);
		assert.deepEqual(result, {
			op: "addIssueLabel",
			number: 123,
			label: "flow:managed",
		});
	});

	it("issue view --json body --jq .body", () => {
		const result = planGhRestCall([
			"issue",
			"view",
			"42",
			"--json",
			"body",
			"--jq",
			".body",
		]);
		assert.deepEqual(result, {
			op: "viewIssue",
			number: 42,
			fields: ["body"],
			jqField: "body",
		});
	});

	// A jq program is not something this layer evaluates, and a `.field` naming
	// something the caller never requested has no value to select.
	it("issue view with a --jq this layer cannot evaluate is unanswerable", () => {
		const jq = (expr) =>
			planGhRestCall(["issue", "view", "42", "--json", "body", "--jq", expr]);
		assert.equal(jq(".comments[].body"), null);
		assert.equal(jq(".author.login"), null);
		assert.equal(jq(".title"), null);
	});

	// Without --jq, gh prints the JSON object itself, and the callers that ask
	// for several fields parse it. Mapping that to the body-only op handed them
	// a string to JSON.parse, and the resulting throw was reported as gh being
	// unavailable (#745).
	it("issue view --json with several fields keeps the object shape", () => {
		const result = planGhRestCall([
			"issue",
			"view",
			"42",
			"--json",
			"author,body,comments,createdAt",
		]);
		assert.deepEqual(result, {
			op: "viewIssue",
			number: 42,
			fields: ["author", "body", "comments", "createdAt"],
		});
	});

	it("issue view without --json is not something the fallback can answer", () => {
		assert.equal(planGhRestCall(["issue", "view", "42"]), null);
	});

	it("pr list", () => {
		const result = planGhRestCall([
			"pr",
			"list",
			"--state",
			"open",
			"--json",
			"number,title,headRefName,statusCheckRollup",
		]);
		assert.deepEqual(result, { op: "listOpenPrsWithCi" });
	});

	// The terminal gate reads the PR body to look for Size-Override, and used to
	// call gh directly — so in a gh-less environment the body came back empty
	// and read as "no override was written" (#749).
	it("pr view --json body --jq .body, for the current branch's PR", () => {
		const result = planGhRestCall([
			"pr",
			"view",
			"--json",
			"body",
			"--jq",
			".body",
		]);
		assert.deepEqual(result, {
			op: "viewCurrentPr",
			fields: ["body"],
			jqField: "body",
		});
	});

	it("pr view --json body keeps the object shape without --jq", () => {
		assert.deepEqual(planGhRestCall(["pr", "view", "--json", "body"]), {
			op: "viewCurrentPr",
			fields: ["body"],
		});
	});

	it("pr view naming an explicit PR is not the current-branch question", () => {
		assert.equal(planGhRestCall(["pr", "view", "12", "--json", "body"]), null);
	});

	it("pr view with a --jq this layer cannot evaluate is unanswerable", () => {
		assert.equal(
			planGhRestCall(["pr", "view", "--json", "body", "--jq", ".title"]),
			null,
		);
	});

	it("returns null for an unrecognized argv shape", () => {
		assert.equal(planGhRestCall(["repo", "view"]), null);
	});
});
