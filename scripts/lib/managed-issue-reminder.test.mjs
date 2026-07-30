import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	createdIssueNumber,
	createsManagedIssue,
	formatManagedIssueAdvisory,
} from "./managed-issue-reminder.mjs";

const CREATED_URL = "https://github.com/takasek/pfdsl/issues/671";

function payload({ command, response = { stdout: `${CREATED_URL}\n`, stderr: "" } }) {
	return {
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command },
		tool_response: response,
	};
}

describe("createsManagedIssue", () => {
	it("flags a create carrying the flow:managed label", () => {
		assert.equal(createsManagedIssue("gh issue create --title x --label flow:managed"), true);
	});

	it("flags the short flag, the = form, and a comma-separated label list", () => {
		assert.equal(createsManagedIssue("gh issue create -l flow:managed -t x"), true);
		assert.equal(createsManagedIssue("gh issue create --label=flow:managed"), true);
		assert.equal(createsManagedIssue("gh issue create --label enhancement,flow:managed"), true);
	});

	it("ignores an exempt issue, which is deliberately not in the roadmap", () => {
		assert.equal(createsManagedIssue("gh issue create --label flow:exempt"), false);
	});

	it("ignores an unlabelled create and other issue verbs", () => {
		assert.equal(createsManagedIssue("gh issue create --title x --body y"), false);
		assert.equal(createsManagedIssue("gh issue edit 650 --add-label flow:managed"), false);
		assert.equal(createsManagedIssue("gh issue list --label flow:managed"), false);
	});

	it("does not flag the command inside a quoted string", () => {
		assert.equal(createsManagedIssue('echo "gh issue create --label flow:managed"'), false);
	});

	it("ignores a non-string command", () => {
		assert.equal(createsManagedIssue(undefined), false);
	});
});

describe("createdIssueNumber", () => {
	it("reads the number off the URL gh prints on success", () => {
		assert.equal(createdIssueNumber({ stdout: `${CREATED_URL}\n`, stderr: "" }), "671");
	});

	it("reads it from a plain-string response too", () => {
		assert.equal(createdIssueNumber(CREATED_URL), "671");
	});

	it("is null when the command failed, so a failed create stays silent", () => {
		assert.equal(createdIssueNumber({ stdout: "", stderr: "could not create issue" }), null);
		assert.equal(createdIssueNumber(undefined), null);
	});
});

describe("formatManagedIssueAdvisory", () => {
	it("names the created issue and the file it belongs in", () => {
		const advisory = formatManagedIssueAdvisory(
			payload({ command: "gh issue create --title x --label flow:managed" }),
		);
		assert.match(advisory, /#671/);
		assert.match(advisory, /roadmap\.pfdsl/);
	});

	it("is undefined for an exempt issue", () => {
		assert.equal(
			formatManagedIssueAdvisory(payload({ command: "gh issue create --label flow:exempt" })),
			undefined,
		);
	});

	it("is undefined when the create did not succeed", () => {
		const advisory = formatManagedIssueAdvisory(
			payload({
				command: "gh issue create --label flow:managed",
				response: { stdout: "", stderr: "HTTP 422" },
			}),
		);
		assert.equal(advisory, undefined);
	});

	it("is undefined for tools other than Bash", () => {
		assert.equal(
			formatManagedIssueAdvisory({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: {} }),
			undefined,
		);
	});
});
