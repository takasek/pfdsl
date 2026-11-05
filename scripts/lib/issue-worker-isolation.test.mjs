import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("issue-worker uses its caller's assigned worktree instead of creating one", () => {
	const text = readFileSync(
		new URL("../../.claude/agents/issue-worker.md", import.meta.url),
		"utf8",
	);
	assert.match(text, /割り当て/);
	assert.doesNotMatch(text, /git worktree add/);
});
