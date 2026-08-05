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
		assert.deepEqual(result, { op: "getIssueBody", number: 42 });
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

	it("returns null for an unrecognized argv shape", () => {
		assert.equal(planGhRestCall(["repo", "view"]), null);
	});
});
