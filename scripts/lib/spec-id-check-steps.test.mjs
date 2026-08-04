import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runSpecIdCheck } from "./spec-id-check-steps.mjs";

describe("runSpecIdCheck", () => {
	it("uses listFiles when no files are given on argv", () => {
		const calls = [];
		runSpecIdCheck({
			args: [],
			listFiles: () => {
				calls.push("listFiles");
				return [];
			},
			readFile: () => "",
		});
		assert.deepEqual(calls, ["listFiles"]);
	});

	it("uses the given argv files instead of listFiles", () => {
		const listFilesCalls = [];
		const readCalls = [];
		runSpecIdCheck({
			args: ["a.md"],
			listFiles: () => {
				listFilesCalls.push("listFiles");
				return ["should-not-be-used.md"];
			},
			readFile: (file) => {
				readCalls.push(file);
				return "";
			},
		});
		assert.deepEqual(listFilesCalls, []);
		assert.deepEqual(readCalls, ["a.md"]);
	});

	it("exits 0 with a no-violations message on stdout when there are none", () => {
		const result = runSpecIdCheck({
			args: ["a.md"],
			listFiles: () => [],
			readFile: () => "## Heading (SPEC_foo)\nsee [[SPEC_foo]]",
		});
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.stdoutLines, [
			"check-spec-ids: no violations found",
		]);
		assert.deepEqual(result.stderrLines, []);
	});

	// The exact `||` the issue calls out (#645): a duplicates-only case must
	// independently trigger failure. An `&&` mutation would wrongly pass here,
	// since dangling.length is 0.
	it("fails on duplicate definitions alone, with no dangling refs", () => {
		const result = runSpecIdCheck({
			args: ["a.md"],
			listFiles: () => [],
			readFile: () => "## A (SPEC_foo)\n## B (SPEC_foo)",
		});
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/1 duplicate definition\(s\), 0 dangling strict reference\(s\)/,
		);
		assert.match(
			result.stderrLines[1],
			/duplicate definition of id "SPEC_foo"/,
		);
	});

	// The other half of the same `||`: a dangling-only case must independently
	// trigger failure. An `&&` mutation would wrongly pass here too, since
	// duplicates.length is 0.
	it("fails on a dangling strict reference alone, with no duplicates", () => {
		const result = runSpecIdCheck({
			args: ["a.md"],
			listFiles: () => [],
			readFile: () => "see [[SPEC_bar]]",
		});
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/0 duplicate definition\(s\), 1 dangling strict reference\(s\)/,
		);
		assert.match(result.stderrLines[1], /dangling strict reference "SPEC_bar"/);
	});

	it("aggregates hits across multiple files before evaluating duplicates/dangling", () => {
		const texts = {
			"a.md": "## A (SPEC_foo)",
			"b.md": "## B (SPEC_foo)",
		};
		const result = runSpecIdCheck({
			args: ["a.md", "b.md"],
			listFiles: () => [],
			readFile: (file) => texts[file],
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[1], /a\.md:1, b\.md:1/);
	});
});
