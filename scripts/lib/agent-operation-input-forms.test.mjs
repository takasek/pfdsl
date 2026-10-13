import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInputForm } from "./agent-operation-input-forms.mjs";

const tokens = (...values) => values.map((value) => ({ value }));
test("declared value options consume data before selecting API operands", () => {
	const parsed = parseInputForm(
		tokens(
			"--jq",
			".",
			"--cache",
			"1h",
			"-X",
			"PUT",
			"repos/o/r/pulls/1/merge",
		),
		"gh api",
	);
	assert.deepEqual(
		parsed.operands.map(({ value }) => value),
		["repos/o/r/pulls/1/merge"],
	);
	assert.equal(parsed.values.find(({ flag }) => flag === "-X").value, "PUT");
	assert.deepEqual(parsed.issues, []);
});
test("unknown options and missing required values are unresolved and never expose private values", () => {
	const parsed = parseInputForm(
		tokens("--not-declared=/fixture/private", "--jq"),
		"gh api",
	);
	assert.deepEqual(parsed.unknownOptions, ["--not-declared"]);
	assert.deepEqual(parsed.issues, ["unknown-option", "missing-option-value"]);
	assert.doesNotMatch(
		JSON.stringify({
			issues: parsed.issues,
			unknownOptions: parsed.unknownOptions,
		}),
		/fixture|private/,
	);
});

test("frequent run filters consume values and rebase merge mode does not", () => {
	const run = parseInputForm(
		tokens("--branch", "main", "--workflow", "ci"),
		"gh run list",
	);
	assert.deepEqual(run.operands, []);
	assert.equal(
		run.values.find(({ flag }) => flag === "--branch").value,
		"main",
	);
	const rebase = parseInputForm(tokens("-m"), "git rebase");
	assert.deepEqual(rebase.issues, []);
});

test("frequent exact option spellings use their declared value arity", () => {
	for (const [name, flag, arity] of [
		["git diff", "--find-copies-harder", "none"],
		["git commit", "--allow-empty", "none"],
		["git commit", "-qm", "required"],
		["git commit", "-am", "required"],
		["git commit", "-qam", "required"],
		["git ls-files", "-i", "none"],
		["git switch", "-qc", "required"],
	]) {
		const parsed = parseInputForm(tokens(flag, "data"), name);
		assert.deepEqual(parsed.issues, [], `${name} ${flag}`);
		assert.equal(parsed.values.length, arity === "required" ? 1 : 0);
	}
});

test("observed once options preserve value bindings without changing operands", () => {
	for (const [name, values, operands] of [
		["git log", ["--find-object", "object", "HEAD"], ["HEAD"]],
		["git init", ["-qb", "topic", "/fixture/new"], ["/fixture/new"]],
		[
			"gh search prs",
			["--limit", "10", "--json", "number", "--jq", ".[0]"],
			[],
		],
		["git status", ["--untracked-files=all"], []],
	]) {
		const parsed = parseInputForm(tokens(...values), name);
		assert.deepEqual(parsed.issues, [], name);
		assert.deepEqual(
			parsed.operands.map(({ value }) => value),
			operands,
			name,
		);
	}
});
