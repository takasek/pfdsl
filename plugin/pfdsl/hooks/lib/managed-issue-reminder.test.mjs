import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	createdIssueNumber,
	createsManagedIssue,
	formatManagedIssueAdvisory,
	runManagedIssueReminder,
} from "./managed-issue-reminder.mjs";

const CREATED_URL = "https://github.com/takasek/pfdsl/issues/671";

function payload({
	command,
	response = { stdout: `${CREATED_URL}\n`, stderr: "" },
}) {
	return {
		hook_event_name: "PostToolUse",
		tool_name: "Bash",
		tool_input: { command },
		tool_response: response,
	};
}

describe("createsManagedIssue", () => {
	it("flags a create carrying the flow:managed label", () => {
		assert.equal(
			createsManagedIssue("gh issue create --title x --label flow:managed"),
			true,
		);
	});

	it("flags separated and attached short flags, the = form, and a comma-separated label list", () => {
		assert.equal(
			createsManagedIssue("gh issue create -l flow:managed -t x"),
			true,
		);
		assert.equal(
			createsManagedIssue("gh issue create -lflow:managed -t x"),
			true,
		);
		assert.equal(
			createsManagedIssue("gh issue create --label=flow:managed"),
			true,
		);
		assert.equal(
			createsManagedIssue("gh issue create --label enhancement,flow:managed"),
			true,
		);
	});

	it("ignores an exempt issue, which is deliberately not in the roadmap", () => {
		assert.equal(
			createsManagedIssue("gh issue create --label flow:exempt"),
			false,
		);
	});

	it("flags a quoted label value, which is how a colon-bearing label is usually written", () => {
		assert.equal(
			createsManagedIssue('gh issue create --title x --label "flow:managed"'),
			true,
		);
	});

	it("flags a create behind a gh global flag", () => {
		assert.equal(
			createsManagedIssue(
				"gh --repo owner/repo issue create --label flow:managed",
			),
			true,
		);
	});

	it("allows a managed create followed only by && commands or a trailing separator", () => {
		assert.equal(
			createsManagedIssue(
				"gh issue create -lflow:managed --title x && git status",
			),
			true,
		);
		assert.equal(
			createsManagedIssue("gh issue create -lflow:managed --title x;   "),
			true,
		);
	});

	it("allows an escaped greater-than in an unquoted argument", () => {
		assert.equal(
			createsManagedIssue(
				"gh issue create -lflow:managed --title x\\>y && git status",
			),
			true,
		);
	});

	it("rejects every ambiguous command form", () => {
		const cases = [
			[
				"a fallback URL after ||",
				"gh issue create -lflow:managed --title x || printf https://github.com/takasek/pfdsl/issues/671",
			],
			["a pipe", "gh issue create -lflow:managed --title x | cat"],
			[
				"a background command",
				"gh issue create -lflow:managed --title x & printf https://github.com/takasek/pfdsl/issues/671",
			],
			[
				"an independent semicolon command",
				"gh issue create -lflow:managed --title x ; printf https://github.com/takasek/pfdsl/issues/671",
			],
			[
				"an independent newline command",
				"gh issue create -lflow:managed --title x\nprintf https://github.com/takasek/pfdsl/issues/671",
			],
			[
				"a subshell",
				"(gh issue create -lflow:managed --title x)",
			],
			[
				"a preceding command",
				"printf https://github.com/takasek/pfdsl/issues/671 && gh issue create -lflow:managed --title x",
			],
			[
				"create output redirection",
				"gh issue create -lflow:managed --title x > issue-url && printf https://github.com/takasek/pfdsl/issues/671",
			],
		];
		for (const [name, command] of cases) {
			assert.equal(createsManagedIssue(command), false, name);
			assert.equal(formatManagedIssueAdvisory(payload({ command })), undefined, name);
		}
	});

	it("does not flag a managed create preceded by another command", () => {
		assert.equal(
			createsManagedIssue(
				"printf https://github.com/takasek/pfdsl/issues/671 && gh issue create -lflow:managed --title x",
			),
			false,
		);
	});

	it("does not read a label out of some other flag's value", () => {
		assert.equal(
			createsManagedIssue('gh issue create --title "flow:managed" --label bug'),
			false,
		);
	});

	it("does not treat a stray create in a flag value as the verb", () => {
		assert.equal(
			createsManagedIssue(
				"gh issue edit 650 --title create --add-label flow:managed",
			),
			false,
		);
	});

	it("ignores an unlabelled create and other issue verbs", () => {
		assert.equal(
			createsManagedIssue("gh issue create --title x --body y"),
			false,
		);
		assert.equal(
			createsManagedIssue("gh issue edit 650 --add-label flow:managed"),
			false,
		);
		assert.equal(
			createsManagedIssue("gh issue list --label flow:managed"),
			false,
		);
	});

	it("does not flag the command inside a quoted string", () => {
		assert.equal(
			createsManagedIssue('echo "gh issue create --label flow:managed"'),
			false,
		);
	});

	it("ignores a non-string command", () => {
		assert.equal(createsManagedIssue(undefined), false);
	});
});

describe("createdIssueNumber", () => {
	it("reads the number off the URL gh prints on success", () => {
		assert.equal(
			createdIssueNumber({ stdout: `${CREATED_URL}\n`, stderr: "" }),
			"671",
		);
	});

	it("reads it from a plain-string response too", () => {
		assert.equal(createdIssueNumber(CREATED_URL), "671");
	});

	it("is null when the command failed, so a failed create stays silent", () => {
		assert.equal(
			createdIssueNumber({ stdout: "", stderr: "could not create issue" }),
			null,
		);
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
			formatManagedIssueAdvisory(
				payload({ command: "gh issue create --label flow:exempt" }),
			),
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
			formatManagedIssueAdvisory({
				hook_event_name: "PostToolUse",
				tool_name: "Write",
				tool_input: {},
			}),
			undefined,
		);
	});
});

describe("runManagedIssueReminder", () => {
	it("prints the advisory for a successful managed create", () => {
		const input = JSON.stringify(
			payload({ command: "gh issue create --label flow:managed" }),
		);
		const { shouldOutput, output } = runManagedIssueReminder(input);
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
		assert.match(output.hookSpecificOutput.additionalContext, /#671/);
	});

	it("produces no output for an exempt create", () => {
		const input = JSON.stringify(
			payload({ command: "gh issue create --label flow:exempt" }),
		);
		assert.deepEqual(runManagedIssueReminder(input), { shouldOutput: false });
	});

	it("silently allows malformed stdin JSON", () => {
		assert.deepEqual(runManagedIssueReminder("not json{{{"), {
			shouldOutput: false,
		});
	});
});
