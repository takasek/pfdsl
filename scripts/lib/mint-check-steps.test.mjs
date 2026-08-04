import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runMintCheck } from "./mint-check-steps.mjs";

describe("runMintCheck", () => {
	it("exits 2 with the usage message when slugArg is missing", () => {
		const result = runMintCheck({
			slugArg: undefined,
			fileArgs: [],
			readFile: () => "",
		});
		assert.equal(result.exitCode, 2);
		assert.equal(result.stdout, null);
		assert.equal(
			result.stderr,
			"usage: node scripts/mint-check.mjs <slug> [files...]",
		);
	});

	it("defaults the file list to docs/spec/spec.md when no files are given", () => {
		const calls = [];
		runMintCheck({
			slugArg: "foo",
			fileArgs: [],
			readFile: (file) => {
				calls.push(file);
				return "";
			},
		});
		assert.deepEqual(calls, ["docs/spec/spec.md"]);
	});

	it("reads every given file instead of the default when files are given", () => {
		const calls = [];
		runMintCheck({
			slugArg: "foo",
			fileArgs: ["a.md", "b.md"],
			readFile: (file) => {
				calls.push(file);
				return "";
			},
		});
		assert.deepEqual(calls, ["a.md", "b.md"]);
	});

	it("aggregates occurrences across multiple files", () => {
		const texts = {
			"a.md": "## Def (SPEC_foo)",
			"b.md": "see [[SPEC_foo]]",
		};
		const result = runMintCheck({
			slugArg: "foo",
			fileArgs: ["a.md", "b.md"],
			readFile: (file) => texts[file],
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.stdout, /a\.md:1: definition/);
		assert.match(result.stdout, /b\.md:1: strict-ref/);
	});

	it("exits 0 with a safe-to-mint message and no stdout when there is no prior occurrence", () => {
		const result = runMintCheck({
			slugArg: "foo",
			fileArgs: ["a.md"],
			readFile: () => "nothing relevant here",
		});
		assert.equal(result.exitCode, 0);
		assert.equal(result.stdout, null);
		assert.match(result.stderr, /no prior occurrence — safe to mint/);
	});

	it("exits 1 with occurrences on stdout and a count message when a prior occurrence exists", () => {
		const result = runMintCheck({
			slugArg: "foo",
			fileArgs: ["a.md"],
			readFile: () => "## Def (SPEC_foo)",
		});
		assert.equal(result.exitCode, 1);
		assert.equal(result.stdout, "a.md:1: definition ## Def (SPEC_foo)");
		assert.match(result.stderr, /already occurs 1 time\(s\)/);
	});

	it("normalizes a bare slug to its SPEC_ prefixed form before searching", () => {
		const result = runMintCheck({
			slugArg: "foo",
			fileArgs: ["a.md"],
			readFile: () => "## Def (SPEC_foo)",
		});
		assert.equal(result.exitCode, 1);
	});
});
