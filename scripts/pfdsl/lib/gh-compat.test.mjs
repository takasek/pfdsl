import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isGhUnavailableError, planGhRestCall } from "./gh-compat.mjs";

describe("isGhUnavailableError", () => {
	it("true for ENOENT (gh binary missing)", () => {
		const error = Object.assign(new Error("spawnSync gh ENOENT"), { code: "ENOENT" });
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
		assert.deepEqual(planGhRestCall(["label", "list", "--json", "name,description", "--limit", "100"]), {
			op: "listLabels",
		});
	});

	it("label create", () => {
		const result = planGhRestCall(["label", "create", "flow:managed", "--description", "tracked", "--color", "ededed"]);
		assert.deepEqual(result, { op: "createLabel", name: "flow:managed", description: "tracked", color: "ededed" });
	});

	it("label edit", () => {
		const result = planGhRestCall(["label", "edit", "flow:managed", "--description", "tracked"]);
		assert.deepEqual(result, { op: "editLabel", name: "flow:managed", description: "tracked" });
	});

	it("issue list", () => {
		const result = planGhRestCall(["issue", "list", "--state", "all", "--json", "number,state,stateReason,labels,updatedAt", "--limit", "500"]);
		assert.deepEqual(result, { op: "listIssues" });
	});

	it("issue edit --add-label", () => {
		const result = planGhRestCall(["issue", "edit", "123", "--add-label", "flow:managed"]);
		assert.deepEqual(result, { op: "addIssueLabel", number: 123, label: "flow:managed" });
	});

	it("issue view --json body --jq .body", () => {
		const result = planGhRestCall(["issue", "view", "42", "--json", "body", "--jq", ".body"]);
		assert.deepEqual(result, { op: "getIssueBody", number: 42 });
	});

	it("pr list", () => {
		const result = planGhRestCall(["pr", "list", "--state", "open", "--json", "number,title,headRefName,statusCheckRollup"]);
		assert.deepEqual(result, { op: "listOpenPrsWithCi" });
	});

	it("returns null for an unrecognized argv shape", () => {
		assert.equal(planGhRestCall(["repo", "view"]), null);
	});
});
