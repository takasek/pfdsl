import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	matchesTrigger,
	formatGateTable,
	hasStatusChange,
	statusChangedForArtifact,
	extractGateChecklist,
	deriveManualItems,
} from "./gate-check.mjs";

describe("matchesTrigger", () => {
	it("matches when any file hits the pattern", () => {
		assert.equal(matchesTrigger(["docs/spec/spec.md", "README.md"], /^docs\//), true);
	});

	it("returns false when nothing matches", () => {
		assert.equal(matchesTrigger(["README.md"], /^docs\//), false);
	});

	it("returns false for an empty file list", () => {
		assert.equal(matchesTrigger([], /^docs\//), false);
	});
});

describe("formatGateTable", () => {
	it("renders PASS/FAIL/SKIP rows with symbols", () => {
		const out = formatGateTable([
			{ name: "pfdsl check", status: "PASS" },
			{ name: "gen-skill identity", status: "SKIP", detail: "no skill-source changes" },
			{ name: "audit-issues-flow", status: "FAIL", detail: "diff detected" },
		]);
		assert.match(out, /✓ PASS\s+pfdsl check/);
		assert.match(out, /- SKIP\s+gen-skill identity — no skill-source changes/);
		assert.match(out, /✗ FAIL\s+audit-issues-flow — diff detected/);
	});
});

describe("hasStatusChange", () => {
	it("detects an added status: line", () => {
		const diff = "@@ -1,3 +1,3 @@\n-    status: todo\n+    status: wip\n";
		assert.equal(hasStatusChange(diff), true);
	});

	it("returns false when no status: line changed", () => {
		const diff = "@@ -1,2 +1,2 @@\n-    label: \"old\"\n+    label: \"new\"\n";
		assert.equal(hasStatusChange(diff), false);
	});

	it("ignores the +++/--- file header lines", () => {
		const diff = "--- a/.pfdsl/roadmap.pfdsl\n+++ b/.pfdsl/roadmap.pfdsl\n status: todo\n";
		assert.equal(hasStatusChange(diff), false);
	});

	it("returns false for an empty diff", () => {
		assert.equal(hasStatusChange(""), false);
	});

	it("still detects a status: line whose content itself starts with a dash", () => {
		const diff = "@@ -1,2 +1,2 @@\n--status: dash-prefixed-value\n+status: wip\n";
		assert.equal(hasStatusChange(diff), true);
	});
});

describe("statusChangedForArtifact", () => {
	const before = [
		"artifact:",
		'  ops_checkers:',
		'    label: "scripts"',
		"    status: todo",
		"  retro_due_hook:",
		'    label: "hook"',
		"    status: todo",
		"",
	].join("\n");

	it("detects a status change scoped to the named artifact", () => {
		const after = before.replace(
			'  ops_checkers:\n    label: "scripts"\n    status: todo',
			'  ops_checkers:\n    label: "scripts"\n    status: done',
		);
		assert.equal(statusChangedForArtifact(before, after, "ops_checkers"), true);
	});

	it("ignores a status change on a different artifact", () => {
		const after = before.replace(
			'  retro_due_hook:\n    label: "hook"\n    status: todo',
			'  retro_due_hook:\n    label: "hook"\n    status: wip',
		);
		assert.equal(statusChangedForArtifact(before, after, "ops_checkers"), false);
	});

	it("returns false when the artifact block is missing from both snapshots", () => {
		assert.equal(statusChangedForArtifact(before, before, "nonexistent_artifact"), false);
	});
});

describe("extractGateChecklist", () => {
	const sampleSkillMd = [
		"1. foo",
		"2. bar",
		"3. **反映 — 終端ゲート**:",
		"   - **companion がゲート集約チェッカーを指す場合**、まずそれを実行する",
		"   - [ ] 出力 artifact の status を更新した",
		"   - [ ] 知見を振り分けた",
		"   - [ ] 変更した全 .pfdsl が `check` を通過する",
		"4. **報告**: 完了したプロセス",
	].join("\n");

	it("extracts only the checkbox items between step 3 and step 4", () => {
		assert.deepEqual(extractGateChecklist(sampleSkillMd), [
			"出力 artifact の status を更新した",
			"知見を振り分けた",
			"変更した全 .pfdsl が `check` を通過する",
		]);
	});

	it("returns an empty array when no checklist section is present", () => {
		assert.deepEqual(extractGateChecklist("1. foo\n2. bar\n"), []);
	});
});

describe("deriveManualItems", () => {
	it("drops items already covered by gate-check's mechanized checks", () => {
		const items = ["出力 artifact の status を更新した", "知見を振り分けた", "変更した全 .pfdsl が `check` を通過する"];
		assert.deepEqual(deriveManualItems(items), ["知見を振り分けた"]);
	});

	it("keeps everything when nothing matches the covered keywords", () => {
		const items = ["知見を振り分けた", "PR にまとめた"];
		assert.deepEqual(deriveManualItems(items), items);
	});
});
