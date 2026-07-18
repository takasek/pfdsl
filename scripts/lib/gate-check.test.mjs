import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	matchesTrigger,
	formatGateTable,
	hasStatusChange,
	statusChangedForArtifact,
	extractGateChecklist,
	deriveManualItems,
	GATE_CHECKLIST_SOURCE_PATH,
	VSCODE_EXT_TRIGGER,
	lintCommitSubjects,
	wipTransitionDetected,
	parseAuditTerminals,
	diffNewTerminals,
	diffReadySets,
	classifyAuditIssuesFlowResult,
	AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE,
} from "./gate-check.mjs";

describe("classifyAuditIssuesFlowResult", () => {
	it("PASS when ok", () => {
		assert.deepEqual(classifyAuditIssuesFlowResult(true, 0), { status: "PASS" });
	});

	it("SKIP with gh-unavailable detail when exit code is the gh-unavailable code", () => {
		const result = classifyAuditIssuesFlowResult(false, AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE);
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	it("FAIL for a real findings/error exit code", () => {
		const result = classifyAuditIssuesFlowResult(false, 1);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /findings/);
	});
});

describe("VSCODE_EXT_TRIGGER", () => {
	it("matches files under packages/vscode-extension", () => {
		assert.equal(matchesTrigger(["packages/vscode-extension/src/extension.ts"], VSCODE_EXT_TRIGGER), true);
	});

	it("does not match files outside packages/vscode-extension", () => {
		assert.equal(matchesTrigger(["packages/cli/src/index.ts"], VSCODE_EXT_TRIGGER), false);
	});
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
			{ name: "gen-plugin identity", status: "SKIP", detail: "no skill/plugin-source changes" },
			{ name: "audit-issues-flow", status: "FAIL", detail: "diff detected" },
		]);
		assert.match(out, /✓ PASS\s+pfdsl check/);
		assert.match(out, /- SKIP\s+gen-plugin identity — no skill\/plugin-source changes/);
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

describe("lintCommitSubjects", () => {
	it("accepts a Conventional Commits subject", () => {
		const results = lintCommitSubjects(["feat(gate-check): add commit lint"]);
		assert.deepEqual(results, [{ subject: "feat(gate-check): add commit lint", ok: true }]);
	});

	it("accepts a breaking-change subject with !", () => {
		const results = lintCommitSubjects(["feat!: drop legacy flag"]);
		assert.equal(results[0].ok, true);
	});

	it("accepts a subject with no scope", () => {
		const results = lintCommitSubjects(["docs: clarify companion rule"]);
		assert.equal(results[0].ok, true);
	});

	it("rejects a subject with no type prefix", () => {
		const results = lintCommitSubjects(["add commit lint"]);
		assert.equal(results[0].ok, false);
	});

	it("rejects an unknown type", () => {
		const results = lintCommitSubjects(["wip: something"]);
		assert.equal(results[0].ok, false);
	});

	it("rejects a merge-style subject that lacks a colon", () => {
		const results = lintCommitSubjects(["Merge pull request #466 from foo/bar"]);
		assert.equal(results[0].ok, false);
	});

	it("accepts a comma-separated multi-package scope (#498)", () => {
		const results = lintCommitSubjects([
			"fix(core,vscode-extension): use a minimal insert edit instead of full-document replace",
		]);
		assert.equal(results[0].ok, true);
	});

	it("returns one result per subject, preserving order", () => {
		const results = lintCommitSubjects(["feat: a", "not conventional"]);
		assert.deepEqual(
			results.map((r) => r.ok),
			[true, false],
		);
	});
});

describe("wipTransitionDetected", () => {
	const wipSnapshot = ["artifact:", "  ops_checkers:", '    label: "scripts"', "    status: wip", ""].join("\n");
	const todoSnapshot = ["artifact:", "  ops_checkers:", '    label: "scripts"', "    status: todo", ""].join("\n");
	const doneSnapshot = ["artifact:", "  ops_checkers:", '    label: "scripts"', "    status: done", ""].join("\n");
	const otherWipSnapshot = ["artifact:", "  retro_due_hook:", '    label: "hook"', "    status: wip", ""].join("\n");

	it("detects a wip snapshot for the named artifact", () => {
		assert.equal(wipTransitionDetected([todoSnapshot, wipSnapshot, doneSnapshot], "ops_checkers"), true);
	});

	it("returns false when the named artifact was never wip", () => {
		assert.equal(wipTransitionDetected([todoSnapshot, doneSnapshot], "ops_checkers"), false);
	});

	it("ignores a wip snapshot belonging to a different artifact", () => {
		assert.equal(wipTransitionDetected([todoSnapshot, otherWipSnapshot, doneSnapshot], "ops_checkers"), false);
	});

	it("without an artifact key, detects wip anywhere in any snapshot", () => {
		assert.equal(wipTransitionDetected([todoSnapshot, otherWipSnapshot]), true);
	});

	it("returns false for an empty snapshot list", () => {
		assert.equal(wipTransitionDetected([], "ops_checkers"), false);
	});
});

describe("parseAuditTerminals", () => {
	it("parses the comma-separated terminal artifacts line", () => {
		const text = "terminal artifacts: spec_v0010, article, obsidian_plugin\nexternal inputs: adr_corpus\n";
		assert.deepEqual(parseAuditTerminals(text), ["spec_v0010", "article", "obsidian_plugin"]);
	});

	it("returns an empty array when there is no terminal artifacts line", () => {
		assert.deepEqual(parseAuditTerminals("external inputs: adr_corpus\n"), []);
	});

	it("returns an empty array when the terminal artifacts line is empty", () => {
		assert.deepEqual(parseAuditTerminals("terminal artifacts: \nexternal inputs:\n"), []);
	});
});

describe("diffNewTerminals", () => {
	it("returns terminals present after but not before", () => {
		assert.deepEqual(diffNewTerminals(["a", "b"], ["a", "b", "c"]), ["c"]);
	});

	it("returns an empty array when nothing new was added", () => {
		assert.deepEqual(diffNewTerminals(["a", "b"], ["a"]), []);
	});

	it("returns an empty array for identical sets", () => {
		assert.deepEqual(diffNewTerminals(["a", "b"], ["a", "b"]), []);
	});
});

describe("diffReadySets", () => {
	it("finds processes that became newly ready", () => {
		const result = diffReadySets(["p1", "p2"], ["p1", "p2", "p3"]);
		assert.deepEqual(result, { newlyReady: ["p3"], noLongerReady: [] });
	});

	it("finds processes that are no longer ready", () => {
		const result = diffReadySets(["p1", "p2"], ["p1"]);
		assert.deepEqual(result, { newlyReady: [], noLongerReady: ["p2"] });
	});

	it("handles both directions changing at once", () => {
		const result = diffReadySets(["p1", "p2"], ["p1", "p3"]);
		assert.deepEqual(result, { newlyReady: ["p3"], noLongerReady: ["p2"] });
	});

	it("returns empty arrays for identical sets", () => {
		assert.deepEqual(diffReadySets(["p1"], ["p1"]), { newlyReady: [], noLongerReady: [] });
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

	it("drops the Conventional Commits subject-format item, keeps the granularity item", () => {
		const items = ["コミット粒度が規約に従っている", "コミット subject が Conventional Commits 形式に従う"];
		assert.deepEqual(deriveManualItems(items), ["コミット粒度が規約に従っている"]);
	});
});

describe("GATE_CHECKLIST_SOURCE_PATH", () => {
	it("points at a file whose checklist section yields MANUAL items", () => {
		const text = readFileSync(resolve(root, GATE_CHECKLIST_SOURCE_PATH), "utf-8");
		const items = deriveManualItems(extractGateChecklist(text));
		assert.ok(items.length > 0, "expected at least one MANUAL checklist item from the deployed source file");
	});
});
