import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateClosesCreateGuard } from "./closes-create-guard.mjs";
import { evaluateCommandUsageGuard } from "./command-usage-guard.mjs";
import { findVerificationSegments } from "./verification-tree-guard.mjs";

test("content guards leave shell inspection failures to the operation entry", () => {
	const payload = {
		tool_name: "Bash",
		tool_input: { command: "gh issue view 1 --comments; (" },
	};
	assert.equal(evaluateCommandUsageGuard(payload).decision, "allow");
	assert.equal(
		evaluateClosesCreateGuard(
			{ ...payload, tool_input: { command: "gh pr create --body missing; (" } },
			{ getDefaultBranch: () => "main", readFile: () => "" },
		).decision,
		"allow",
	);
	assert.deepEqual(findVerificationSegments("make test; ("), []);
});

test("content guards distinguish shell data from executed commands", () => {
	const command =
		"cat <<'DATA'\ngh issue view 1 --comments\ngh pr create --body missing\nmake test\nDATA";
	const payload = { tool_name: "Bash", tool_input: { command } };
	assert.equal(evaluateCommandUsageGuard(payload).decision, "allow");
	assert.equal(
		evaluateClosesCreateGuard(payload, {
			getDefaultBranch: () => "main",
			readFile: () => "",
		}).decision,
		"allow",
	);
	assert.deepEqual(findVerificationSegments(command), []);
});
