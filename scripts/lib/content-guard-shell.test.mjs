import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateClosesCreateGuard } from "./closes-create-guard.mjs";

test("the PR content guard leaves uninspectable shell input to CI", () => {
	const payload = {
		tool_name: "Bash",
		tool_input: { command: "gh issue view 1 --comments; (" },
	};
	assert.equal(
		evaluateClosesCreateGuard(
			{ ...payload, tool_input: { command: "gh pr create --body missing; (" } },
			{ getDefaultBranch: () => "main", readFile: () => "" },
		).decision,
		"allow",
	);
});

test("the PR content guard distinguishes shell data from executed commands", () => {
	const command =
		"cat <<'DATA'\ngh issue view 1 --comments\ngh pr create --body missing\nmake test\nDATA";
	const payload = { tool_name: "Bash", tool_input: { command } };
	assert.equal(
		evaluateClosesCreateGuard(payload, {
			getDefaultBranch: () => "main",
			readFile: () => "",
		}).decision,
		"allow",
	);
});
