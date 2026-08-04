import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenize } from "./delegation-guard.mjs";
import { flagValues, parseGhCommand } from "./gh-command.mjs";

/** @param {string} segment */
function parse(segment) {
	return parseGhCommand(tokenize(segment));
}

describe("parseGhCommand", () => {
	it("reads the group and verb of a plain call", () => {
		assert.deepEqual(parse("gh issue view 650"), {
			group: "issue",
			verb: "view",
			args: ["issue", "view", "650"],
		});
	});

	it("looks past a global flag and its value", () => {
		assert.equal(parse("gh -R owner/repo issue view 650")?.group, "issue");
		assert.equal(parse("gh -R owner/repo issue view 650")?.verb, "view");
		assert.equal(
			parse("gh --repo owner/repo issue create --title x")?.verb,
			"create",
		);
		assert.equal(parse("gh --repo=owner/repo pr create")?.verb, "create");
	});

	it("looks past a valueless global flag", () => {
		assert.equal(parse("gh --help issue view")?.group, "issue");
	});

	it("keeps the group even when the verb is missing", () => {
		assert.deepEqual(parse("gh pr"), { group: "pr", verb: null, args: ["pr"] });
	});

	it("reads a quoted group or verb — the quotes do not change what runs", () => {
		assert.equal(parse('gh issue "view" 650')?.verb, "view");
	});

	it("is null for anything that is not a gh call", () => {
		assert.equal(parse("git status"), null);
		assert.equal(parse('echo "gh issue view 650"'), null);
		assert.equal(parse(""), null);
	});
});

describe("flagValues", () => {
	it("collects the value that follows a flag", () => {
		const parsed = parse("gh issue create --title x --label flow:managed");
		assert.deepEqual(flagValues(parsed.args, ["--label", "-l"]), [
			"flow:managed",
		]);
	});

	it("collects the = form and the short form", () => {
		assert.deepEqual(
			flagValues(parse("gh issue create --label=flow:managed").args, [
				"--label",
				"-l",
			]),
			["flow:managed"],
		);
		assert.deepEqual(
			flagValues(parse("gh issue create -l flow:exempt").args, [
				"--label",
				"-l",
			]),
			["flow:exempt"],
		);
	});

	it("collects a quoted value, and every occurrence of the flag", () => {
		const parsed = parse(
			'gh issue create --label "flow:managed" --label enhancement',
		);
		assert.deepEqual(flagValues(parsed.args, ["--label"]), [
			"flow:managed",
			"enhancement",
		]);
	});

	it("is empty when the flag is absent or has no value", () => {
		assert.deepEqual(
			flagValues(parse("gh issue create --title x").args, ["--label"]),
			[],
		);
		assert.deepEqual(
			flagValues(parse("gh issue create --label").args, ["--label"]),
			[],
		);
	});

	it("does not read the next flag as a value", () => {
		assert.deepEqual(
			flagValues(parse("gh issue create --label --json").args, ["--label"]),
			[],
		);
	});
});
