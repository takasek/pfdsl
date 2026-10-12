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
