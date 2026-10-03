import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// These tests verify paths and command arguments, not prose meaning.
// Applicability and condition changes require independent adopter scenarios.
const skill = readFileSync(".claude/skills/pfd-ops/SKILL.md", "utf8");
const retro = readFileSync(".claude/skills/pfd-retro/SKILL.md", "utf8");

describe("pfd-ops mechanical contracts", () => {
	it("references existing work-cycle and backend resources", () => {
		for (const path of [
			"references/work-cycle.md",
			"references/architecture.md",
			"references/github-issues-backend.md",
			"references/file-based-tracker-backend.md",
		]) {
			assert.ok(skill.includes(path));
			assert.ok(existsSync(`.claude/skills/pfd-ops/${path}`));
		}
	});

	it("queries session issues with state, labels and creation time", () => {
		const issueView = retro.match(
			/gh\s+issue\s+view\s+<number>\s+--json\s+([^\s`]+)/,
		);
		assert.ok(issueView);
		assert.deepEqual(
			new Set(issueView[1].split(",")),
			new Set(["number", "state", "labels", "createdAt"]),
		);
		assert.doesNotMatch(
			retro,
			/gh\s+issue\s+list\b[^\n`]*--state(?:=|\s+)open\b/,
		);
	});
});
