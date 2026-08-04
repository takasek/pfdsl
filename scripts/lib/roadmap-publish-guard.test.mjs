import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	addedPublishProcesses,
	evaluateRoadmapPublishGuard,
	runRoadmapPublishGuard,
} from "./roadmap-publish-guard.mjs";

const ROADMAP = "/repo/.pfdsl/roadmap.pfdsl";

function edit({ filePath = ROADMAP, oldString = "", newString }) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: "Edit",
		tool_input: {
			file_path: filePath,
			old_string: oldString,
			new_string: newString,
		},
	};
}

function write({ filePath = ROADMAP, content }) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: "Write",
		tool_input: { file_path: filePath, content },
	};
}

describe("addedPublishProcesses", () => {
	it("finds a newly declared publish process", () => {
		const added = addedPublishProcesses(
			"  publish_cli_query_tools:\n    label: release\n",
			"",
		);
		assert.deepEqual(added, ["publish_cli_query_tools"]);
	});

	it("ignores a declaration that was already in the replaced text", () => {
		const before = "  publish_ext_v0016:\n    label: release\n";
		const after = "  publish_ext_v0016:\n    label: release ext\n";
		assert.deepEqual(addedPublishProcesses(after, before), []);
	});

	it("ignores a flow line that only references a publish process", () => {
		const added = addedPublishProcesses(
			"[a, b] >> publish_cli_query_tools -> cli_release_query\n",
			"",
		);
		assert.deepEqual(added, []);
	});

	it("ignores declarations of anything else", () => {
		assert.deepEqual(
			addedPublishProcesses("  integrate_spec_v0042:\n", ""),
			[],
		);
		assert.deepEqual(addedPublishProcesses("  published_extension:\n", ""), []);
	});
});

describe("evaluateRoadmapPublishGuard", () => {
	it("asks before an Edit that adds a publish process, naming release-status", () => {
		const result = evaluateRoadmapPublishGuard(
			edit({ newString: "  publish_ext_v0016:\n    label: x\n" }),
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /make release-status/);
		assert.match(result.reason, /publish_ext_v0016/);
	});

	it("asks on a Write of the roadmap that declares one the file did not have", () => {
		const result = evaluateRoadmapPublishGuard(
			write({ content: "processes:\n  publish_cli_x:\n" }),
			{
				readFile: () => "processes:\n",
			},
		);
		assert.equal(result.decision, "ask");
	});

	it("allows a Write that only carries the declarations the file already had", () => {
		const existing = "processes:\n  publish_cli_x:\n    label: release\n";
		const result = evaluateRoadmapPublishGuard(write({ content: existing }), {
			readFile: () => existing,
		});
		assert.equal(result.decision, "allow");
	});

	it("asks on a Write when the file cannot be read, since nothing rules the declaration out", () => {
		const result = evaluateRoadmapPublishGuard(
			write({ content: "  publish_cli_x:\n" }),
			{
				readFile: () => undefined,
			},
		);
		assert.equal(result.decision, "ask");
	});

	it("allows an edit elsewhere in the roadmap", () => {
		const result = evaluateRoadmapPublishGuard(
			edit({ newString: "  status: done\n" }),
		);
		assert.equal(result.decision, "allow");
	});

	it("allows the same declaration in another file, where it means nothing", () => {
		const result = evaluateRoadmapPublishGuard(
			edit({
				filePath: "/repo/docs/notes.md",
				newString: "  publish_ext_v0016:\n",
			}),
		);
		assert.equal(result.decision, "allow");
	});

	it("ignores tools other than Edit and Write", () => {
		const result = evaluateRoadmapPublishGuard({
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command: "echo publish_ext_v0016:" },
		});
		assert.equal(result.decision, "allow");
	});

	it("ignores a payload with no file_path", () => {
		const result = evaluateRoadmapPublishGuard({
			hook_event_name: "PreToolUse",
			tool_name: "Edit",
			tool_input: {},
		});
		assert.equal(result.decision, "allow");
	});
});

describe("runRoadmapPublishGuard", () => {
	it("prints an ask payload when the edit adds a publish process", () => {
		const input = JSON.stringify(edit({ newString: "  publish_ext_v0016:\n" }));
		const { shouldOutput, output } = runRoadmapPublishGuard(input, {
			readFile: () => "",
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
	});

	it("produces no output for an unrelated edit", () => {
		const input = JSON.stringify(edit({ newString: "  status: done\n" }));
		assert.deepEqual(runRoadmapPublishGuard(input, { readFile: () => "" }), {
			shouldOutput: false,
		});
	});

	it("reads the file on disk for a Write, so an unchanged rewrite stays silent", () => {
		const existing = "  publish_ext_v0016:\n";
		const input = JSON.stringify(write({ content: existing }));
		assert.deepEqual(
			runRoadmapPublishGuard(input, { readFile: () => existing }),
			{ shouldOutput: false },
		);
	});

	it("silently allows malformed stdin JSON", () => {
		assert.deepEqual(runRoadmapPublishGuard("not json{{{"), {
			shouldOutput: false,
		});
	});
});
