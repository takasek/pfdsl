import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("issue-worker is started by its caller with native isolation instead of claiming a manual worktree", () => {
	const text = readFileSync(
		new URL("../../.claude/agents/issue-worker.md", import.meta.url),
		"utf8",
	);
	assert.match(text, /呼び出し元.*native.*worktree/);
	assert.match(text, /割り当て/);
	assert.doesNotMatch(text, /git worktree add/);
});
