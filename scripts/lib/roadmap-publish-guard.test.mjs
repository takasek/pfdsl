import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addedPublishProcesses,
	evaluateRoadmapPublishGuard,
	runRoadmapPublishGuard,
} from "./roadmap-publish-guard.mjs";

const ROADMAP = "/repo/.pfdsl/roadmap.pfdsl";
const document = (processes = "", rest = "") =>
	`---\nprocess:\n${processes}\n${rest}\n---\na >> ship -> b\n`;
const existing = document("  ship: { label: Ship, tags: [release_cli] }");
const edit = (oldString, newString, extra = {}) => ({
	tool_name: "Edit",
	tool_input: {
		file_path: ROADMAP,
		old_string: oldString,
		new_string: newString,
		...extra,
	},
});
const write = (content) => ({
	tool_name: "Write",
	tool_input: { file_path: ROADMAP, content },
});

describe("addedPublishProcesses", () => {
	for (const tag of [
		"release_cli",
		"release_extension",
		"release_standalone",
	]) {
		it(`finds an arbitrary process name carrying ${tag}`, () => {
			assert.deepEqual(
				addedPublishProcesses(document(`  ship: { tags: [${tag}] }`), ""),
				["ship"],
			);
		});
	}
	it("handles block sequences, quoted keys, comments and CRLF", () => {
		const after = document(
			'  "ship":\n    tags:\n      - release_cli # release',
		).replaceAll("\n", "\r\n");
		assert.deepEqual(addedPublishProcesses(after, ""), ["ship"]);
	});
	it("ignores ID prefixes, artifacts, groups and similar tag spellings", () => {
		const after = document(
			"  publish_cli_old: { tags: [release_cli_extra] }",
			"artifact:\n  publish_ext_a: { tags: [release_cli] }\ngroup:\n  releases: { tags: [release_cli] }",
		);
		assert.deepEqual(addedPublishProcesses(after, ""), []);
	});
	it("ignores flow references, reformatting and removal", () => {
		const reformatted = document(
			"  ship:\n    tags: [release_cli]\n    label: Ship",
		);
		assert.deepEqual(
			addedPublishProcesses(`${reformatted}\nc >> ship\n`, existing),
			[],
		);
		assert.deepEqual(addedPublishProcesses(document(), existing), []);
	});
	it("notices a tag added to an existing process or a changed release kind", () => {
		assert.deepEqual(
			addedPublishProcesses(existing, document("  ship: { label: Ship }")),
			["ship"],
		);
		assert.deepEqual(
			addedPublishProcesses(
				existing,
				existing.replace("release_cli", "release_extension"),
			),
			["ship"],
		);
	});
	it("does not turn invalid YAML or a scalar tags field into an added release", () => {
		assert.deepEqual(
			addedPublishProcesses(document("  ship: { tags: ["), ""),
			[],
		);
		assert.deepEqual(
			addedPublishProcesses(document("  ship: { tags: release_cli }"), ""),
			[],
		);
	});
});

describe("evaluateRoadmapPublishGuard", () => {
	it("does not present release-status as standalone publication evidence", () => {
		const result = evaluateRoadmapPublishGuard(
			write(document("  ship: { tags: [release_standalone] }")),
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /release-status.*does not report standalone/);
		assert.match(
			result.reason,
			/separately verify the published standalone distribution/,
		);
	});
	it("compares whole documents for a tag-only Edit", () => {
		const before = document("  ship: { tags: [] }");
		const result = evaluateRoadmapPublishGuard(
			edit("tags: []", "tags: [release_cli]"),
			{ readFile: () => before },
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /make release-status/);
		assert.match(result.reason, /ship/);
	});
	it("allows editing an artifact tag without a process declaration in the fragment", () => {
		const before = document(
			"  ship: { label: Ship }",
			"artifact:\n  result: { tags: [] }",
		);
		assert.equal(
			evaluateRoadmapPublishGuard(edit("tags: []", "tags: [release_cli]"), {
				readFile: () => before,
			}).decision,
			"allow",
		);
	});
	it("handles replace_all across process and artifact declarations", () => {
		const before = document(
			"  ship: { tags: [] }",
			"artifact:\n  result: { tags: [] }",
		);
		const result = evaluateRoadmapPublishGuard(
			edit("tags: []", "tags: [release_cli]", { replace_all: true }),
			{ readFile: () => before },
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /ship/);
		assert.doesNotMatch(result.reason, /process result/);
	});
	it("does not guess an Edit whose original is missing or ambiguous", () => {
		for (const before of [
			undefined,
			existing,
			document("  a: { tags: [] }\n  b: { tags: [] }"),
		]) {
			assert.equal(
				evaluateRoadmapPublishGuard(edit("tags: []", "tags: [release_cli]"), {
					readFile: () => before,
				}).decision,
				"allow",
			);
		}
	});
	it("allows ordinary label and flow edits", () => {
		for (const payload of [
			edit("label: Ship", "label: Release"),
			edit("a >> ship", "[a, c] >> ship"),
		]) {
			assert.equal(
				evaluateRoadmapPublishGuard(payload, { readFile: () => existing })
					.decision,
				"allow",
			);
		}
	});
	it("asks for a Write with a new tagged process, including a new file", () => {
		for (const before of [undefined, document()]) {
			assert.equal(
				evaluateRoadmapPublishGuard(write(existing), { readFile: () => before })
					.decision,
				"ask",
			);
		}
	});
	it("allows a Write that carries only existing releases", () => {
		assert.equal(
			evaluateRoadmapPublishGuard(write(existing), { readFile: () => existing })
				.decision,
			"allow",
		);
	});
	it("ignores other files and tools", () => {
		for (const payload of [
			edit("", existing, { file_path: "/repo/notes.md" }),
			{ tool_name: "Bash", tool_input: { command: "echo release_cli" } },
			{ tool_name: "Edit", tool_input: {} },
		]) {
			assert.equal(evaluateRoadmapPublishGuard(payload).decision, "allow");
		}
	});
});

describe("runRoadmapPublishGuard", () => {
	it("prints an ask payload for a new release and stays silent for a rewrite", () => {
		const input = JSON.stringify(write(existing));
		const result = runRoadmapPublishGuard(input, { readFile: () => "" });
		assert.equal(result.shouldOutput, true);
		assert.equal(result.output.hookSpecificOutput.permissionDecision, "ask");
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
