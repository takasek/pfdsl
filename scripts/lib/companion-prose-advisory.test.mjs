import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addedProseLines,
	isCompanionProseAddition,
	runCompanionProseAdvisory,
} from "./companion-prose-advisory.mjs";

describe("addedProseLines", () => {
	it("returns a Write's non-blank lines", () => {
		const lines = addedProseLines({
			tool_name: "Write",
			tool_input: { file_path: "/repo/.pfdsl/roadmap.md", content: "a\n\nb\n" },
		});
		assert.deepEqual(lines, ["a", "b"]);
	});

	it("returns only the lines an Edit introduced", () => {
		const lines = addedProseLines({
			tool_name: "Edit",
			tool_input: {
				file_path: "/repo/.pfdsl/roadmap.md",
				old_string: "kept line\n",
				new_string: "kept line\nbrand new rule\n",
			},
		});
		assert.deepEqual(lines, ["brand new rule"]);
	});

	it("returns nothing when an Edit only deletes", () => {
		const lines = addedProseLines({
			tool_name: "Edit",
			tool_input: {
				file_path: "/repo/.pfdsl/roadmap.md",
				old_string: "kept line\ndoomed line\n",
				new_string: "kept line\n",
			},
		});
		assert.deepEqual(lines, []);
	});
});

describe("isCompanionProseAddition", () => {
	it("flags an addition to a top-level .pfdsl companion", () => {
		const result = isCompanionProseAddition({
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: {
				file_path: "/repo/.pfdsl/workflow.md",
				old_string: "",
				new_string: "a new procedural rule\n",
			},
		});
		assert.equal(result, true);
	});

	it("ignores the graph beside the companion", () => {
		const result = isCompanionProseAddition({
			tool_name: "Write",
			tool_input: {
				file_path: "/repo/.pfdsl/roadmap.pfdsl",
				content: "artifact foo\n",
			},
		});
		assert.equal(result, false);
	});

	it("ignores the retro-pattern catalog — its genre is the trap record, not a rule looking for a home", () => {
		const result = isCompanionProseAddition({
			tool_name: "Write",
			tool_input: {
				file_path: "/repo/.pfdsl/bindings/pfd-retro-patterns/some-trap.md",
				content: "- **some trap**: ...\n",
			},
		});
		assert.equal(result, false);
	});

	it("ignores a delete-only edit", () => {
		const result = isCompanionProseAddition({
			tool_name: "Edit",
			tool_input: {
				file_path: "/repo/.pfdsl/roadmap.md",
				old_string: "gone\nstays\n",
				new_string: "stays\n",
			},
		});
		assert.equal(result, false);
	});
});

describe("runCompanionProseAdvisory", () => {
	it("emits an advisory naming the file and both questions", () => {
		const { shouldOutput, output } = runCompanionProseAdvisory(
			JSON.stringify({
				hook_event_name: "PostToolUse",
				tool_name: "Edit",
				tool_input: {
					file_path: "/repo/.pfdsl/roadmap.md",
					old_string: "",
					new_string: "a new procedural rule\n",
				},
			}),
		);
		assert.equal(shouldOutput, true);
		const advisory = output.hookSpecificOutput.additionalContext;
		assert.match(advisory, /\.pfdsl\/roadmap\.md/);
		assert.match(advisory, /hook|check/);
		assert.match(advisory, /distributed/);
	});

	it("stays quiet on an unrelated change", () => {
		const { shouldOutput } = runCompanionProseAdvisory(
			JSON.stringify({
				tool_name: "Write",
				tool_input: { file_path: "/repo/README.md", content: "hi\n" },
			}),
		);
		assert.equal(shouldOutput, false);
	});

	it("stays quiet on a malformed payload", () => {
		const { shouldOutput } = runCompanionProseAdvisory("not json");
		assert.equal(shouldOutput, false);
	});
});
