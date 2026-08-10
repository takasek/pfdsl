import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RECORD_SEP } from "./commit-trailers.mjs";
import {
	AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE,
	classifyAuditIssuesFlowResult,
	classifyDesignRecordContent,
	classifyDesignRecordTiming,
	classifyIssueLookupFailure,
	classifyOutputArtifactStatus,
	classifySizeDirection,
	DESIGN_RECORD_REQUIRED_PREFIXES,
	DISPOSITION_TOKENS,
	deriveManualItems,
	diffNewTerminals,
	diffReadySets,
	extractGateChecklist,
	formatGateTable,
	formatSizeDelta,
	GATE_CHECKLIST_SOURCE_PATH,
	hasSizeOverride,
	hasStatusChange,
	lintCommitSubjects,
	matchesTrigger,
	parseAuditExternalTerminals,
	parseAuditTerminals,
	SIZE_INTENT_PATTERN,
	SIZE_OVERRIDE_PATTERN,
	SIZE_TRACKED_PATTERNS,
	statusChangedForArtifact,
	VSCODE_EXT_TRIGGER,
	wipTransitionDetected,
} from "./gate-check.mjs";

describe("classifyAuditIssuesFlowResult", () => {
	it("PASS when ok", () => {
		assert.deepEqual(classifyAuditIssuesFlowResult(true, 0), {
			status: "PASS",
		});
	});

	it("SKIP with gh-unavailable detail when exit code is the gh-unavailable code", () => {
		const result = classifyAuditIssuesFlowResult(
			false,
			AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE,
		);
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	it("FAIL for a real findings/error exit code", () => {
		const result = classifyAuditIssuesFlowResult(false, 1);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /findings/);
	});
});

describe("classifyOutputArtifactStatus", () => {
	it("SKIPs when there is no --artifact key and roadmap.pfdsl itself was not touched", () => {
		const result = classifyOutputArtifactStatus({
			artifactKey: undefined,
			roadmapChanged: false,
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /--artifact/);
	});

	it("PASSes on the presence-only fallback when roadmap.pfdsl changed and a status: line moved", () => {
		const result = classifyOutputArtifactStatus({
			artifactKey: undefined,
			roadmapChanged: true,
			changed: true,
		});
		assert.equal(result.status, "PASS");
	});

	it("SKIPs when the cycle declares it has no roadmap output artifact", () => {
		const result = classifyOutputArtifactStatus({
			noArtifact: true,
			roadmapChanged: true,
			changed: false,
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /declared/);
	});

	it("keeps the declaration authoritative even when a status: line did move", () => {
		const result = classifyOutputArtifactStatus({
			noArtifact: true,
			roadmapChanged: true,
			changed: true,
		});
		assert.equal(result.status, "SKIP");
	});

	it("points at the declaration when the fallback FAILs, so the way out is in the message", () => {
		const result = classifyOutputArtifactStatus({
			artifactKey: undefined,
			roadmapChanged: true,
			changed: false,
		});
		assert.match(result.detail, /--no-artifact/);
	});

	it("FAILs on the presence-only fallback when roadmap.pfdsl changed but no status: line moved", () => {
		const result = classifyOutputArtifactStatus({
			artifactKey: undefined,
			roadmapChanged: true,
			changed: false,
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no status: line changed/);
	});

	it("PASSes the strict per-artifact check when a status: change was found for the key", () => {
		const result = classifyOutputArtifactStatus({
			artifactKey: "ops_checkers",
			changed: true,
		});
		assert.equal(result.status, "PASS");
	});

	it("FAILs the strict per-artifact check and names the artifact when no status: change was found", () => {
		const result = classifyOutputArtifactStatus({
			artifactKey: "ops_checkers",
			changed: false,
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /ops_checkers/);
	});
});

describe("VSCODE_EXT_TRIGGER", () => {
	it("matches files under packages/vscode-extension", () => {
		assert.equal(
			matchesTrigger(
				["packages/vscode-extension/src/extension.ts"],
				VSCODE_EXT_TRIGGER,
			),
			true,
		);
	});

	it("does not match files outside packages/vscode-extension", () => {
		assert.equal(
			matchesTrigger(["packages/cli/src/index.ts"], VSCODE_EXT_TRIGGER),
			false,
		);
	});
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("matchesTrigger", () => {
	it("matches when any file hits the pattern", () => {
		assert.equal(
			matchesTrigger(["docs/spec/spec.md", "README.md"], /^docs\//),
			true,
		);
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
			{
				name: "gen-plugin identity",
				status: "SKIP",
				detail: "no skill/plugin-source changes",
			},
			{ name: "audit-issues-flow", status: "FAIL", detail: "diff detected" },
		]);
		assert.match(out, /✓ PASS\s+pfdsl check/);
		assert.match(
			out,
			/- SKIP\s+gen-plugin identity — no skill\/plugin-source changes/,
		);
		assert.match(out, /✗ FAIL\s+audit-issues-flow — diff detected/);
	});
});

describe("hasStatusChange", () => {
	it("detects an added status: line", () => {
		const diff = "@@ -1,3 +1,3 @@\n-    status: todo\n+    status: wip\n";
		assert.equal(hasStatusChange(diff), true);
	});

	it("returns false when no status: line changed", () => {
		const diff = '@@ -1,2 +1,2 @@\n-    label: "old"\n+    label: "new"\n';
		assert.equal(hasStatusChange(diff), false);
	});

	it("ignores the +++/--- file header lines", () => {
		const diff =
			"--- a/.pfdsl/roadmap.pfdsl\n+++ b/.pfdsl/roadmap.pfdsl\n status: todo\n";
		assert.equal(hasStatusChange(diff), false);
	});

	it("returns false for an empty diff", () => {
		assert.equal(hasStatusChange(""), false);
	});

	it("still detects a status: line whose content itself starts with a dash", () => {
		const diff =
			"@@ -1,2 +1,2 @@\n--status: dash-prefixed-value\n+status: wip\n";
		assert.equal(hasStatusChange(diff), true);
	});
});

describe("statusChangedForArtifact", () => {
	const before = [
		"artifact:",
		"  ops_checkers:",
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
		assert.equal(
			statusChangedForArtifact(before, after, "ops_checkers"),
			false,
		);
	});

	it("returns false when the artifact block is missing from both snapshots", () => {
		assert.equal(
			statusChangedForArtifact(before, before, "nonexistent_artifact"),
			false,
		);
	});
});

describe("lintCommitSubjects", () => {
	it("accepts a Conventional Commits subject", () => {
		const results = lintCommitSubjects(["feat(gate-check): add commit lint"]);
		assert.deepEqual(results, [
			{ subject: "feat(gate-check): add commit lint", ok: true },
		]);
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

	// Kept as a statement about this predicate alone. Real merge subjects never
	// reach it: commitSubjectStep collects with --no-merges, because git writes
	// those subjects and no author can make them conventional (#690).
	it("rejects a merge-style subject that lacks a colon", () => {
		const results = lintCommitSubjects([
			"Merge pull request #466 from foo/bar",
		]);
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

	it("reports why a subject failed", () => {
		const results = lintCommitSubjects(["add commit lint"]);
		assert.equal(results[0].reason, "not Conventional Commits");
	});

	// #595: the commit convention is English, but only the format was checked.
	// A delegated subagent carried a Japanese term straight out of its brief
	// into an otherwise English subject and the lint passed it.
	it("rejects a subject with Japanese text outside quoted spans (#595)", () => {
		const results = lintCommitSubjects([
			"refactor(scripts): split gen-skill's references into a dist非依存 module",
		]);
		assert.equal(results[0].ok, false);
		assert.equal(results[0].reason, "non-English text outside quoted spans");
	});

	it("rejects a wholly Japanese subject that is otherwise well-formed (#595)", () => {
		const results = lintCommitSubjects([
			"fix(graphviz-exporter): CJK ラベルに最小ノード幅を付与",
		]);
		assert.equal(results[0].ok, false);
	});

	// Measured on this repo's history: 1 of the 7 subjects carrying CJK quotes a
	// Japanese heading that genuinely exists in the tree. Quoting an identifier
	// is not the failure #595 is after.
	it("accepts Japanese quoted in a backtick code span (#595)", () => {
		const results = lintCommitSubjects([
			"docs(pfd-retro): add a `保留した違和感の想起` step",
		]);
		assert.equal(results[0].ok, true);
	});

	it("accepts Japanese inside double quotes (#595)", () => {
		const results = lintCommitSubjects([
			'feat(pfd-retro): add "保留した違和感の想起" to the catalog',
		]);
		assert.equal(results[0].ok, true);
	});

	it("rejects Japanese that trails a legitimately quoted span (#595)", () => {
		const results = lintCommitSubjects([
			"docs(skill): clarify `前回` refers to 直近のログ",
		]);
		assert.equal(results[0].ok, false);
	});

	it("accepts a plain English subject with no quoting", () => {
		const results = lintCommitSubjects([
			"fix(cli): drop the unreachable default",
		]);
		assert.equal(results[0].ok, true);
	});

	it("catches Japanese that falls between the obvious blocks (#595)", () => {
		for (const subject of [
			"docs(ops): note 人々 here",
			"docs(ops): note ﾊﾝｶｸ here",
		]) {
			assert.equal(lintCommitSubjects([subject])[0].ok, false, subject);
		}
	});
});

describe("wipTransitionDetected", () => {
	const wipSnapshot = [
		"artifact:",
		"  ops_checkers:",
		'    label: "scripts"',
		"    status: wip",
		"",
	].join("\n");
	const todoSnapshot = [
		"artifact:",
		"  ops_checkers:",
		'    label: "scripts"',
		"    status: todo",
		"",
	].join("\n");
	const doneSnapshot = [
		"artifact:",
		"  ops_checkers:",
		'    label: "scripts"',
		"    status: done",
		"",
	].join("\n");
	const otherWipSnapshot = [
		"artifact:",
		"  retro_due_hook:",
		'    label: "hook"',
		"    status: wip",
		"",
	].join("\n");

	it("detects a wip snapshot for the named artifact", () => {
		assert.equal(
			wipTransitionDetected(
				[todoSnapshot, wipSnapshot, doneSnapshot],
				"ops_checkers",
			),
			true,
		);
	});

	it("returns false when the named artifact was never wip", () => {
		assert.equal(
			wipTransitionDetected([todoSnapshot, doneSnapshot], "ops_checkers"),
			false,
		);
	});

	it("ignores a wip snapshot belonging to a different artifact", () => {
		assert.equal(
			wipTransitionDetected(
				[todoSnapshot, otherWipSnapshot, doneSnapshot],
				"ops_checkers",
			),
			false,
		);
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
		const text =
			"terminal artifacts: spec_v0010, article, obsidian_plugin\nexternal inputs: adr_corpus\n";
		assert.deepEqual(parseAuditTerminals(text), [
			"spec_v0010",
			"article",
			"obsidian_plugin",
		]);
	});

	it("returns an empty array when there is no terminal artifacts line", () => {
		assert.deepEqual(parseAuditTerminals("external inputs: adr_corpus\n"), []);
	});

	it("returns an empty array when the terminal artifacts line is empty", () => {
		assert.deepEqual(
			parseAuditTerminals("terminal artifacts: \nexternal inputs:\n"),
			[],
		);
	});
});

describe("parseAuditExternalTerminals", () => {
	it("parses the comma-separated external-stakeholder terminals line", () => {
		const text =
			"external inputs: adr_corpus\nterminal artifacts: article\nexternal-stakeholder terminals: monthly_report, published_skill\n";
		assert.deepEqual(parseAuditExternalTerminals(text), [
			"monthly_report",
			"published_skill",
		]);
	});

	it("returns an empty array when there is no external-stakeholder terminals line", () => {
		assert.deepEqual(
			parseAuditExternalTerminals("terminal artifacts: article\n"),
			[],
		);
	});

	it("returns an empty array when the external-stakeholder terminals line is empty", () => {
		assert.deepEqual(
			parseAuditExternalTerminals(
				"terminal artifacts: article\nexternal-stakeholder terminals: \n",
			),
			[],
		);
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
		assert.deepEqual(diffReadySets(["p1"], ["p1"]), {
			newlyReady: [],
			noLongerReady: [],
		});
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
		const items = [
			"出力 artifact の status を更新した",
			"知見を振り分けた",
			"変更した全 .pfdsl が `check` を通過する",
		];
		assert.deepEqual(deriveManualItems(items), ["知見を振り分けた"]);
	});

	it("keeps everything when nothing matches the covered keywords", () => {
		const items = ["知見を振り分けた", "PR にまとめた"];
		assert.deepEqual(deriveManualItems(items), items);
	});

	it("drops the Conventional Commits subject-format item, keeps the granularity item", () => {
		const items = [
			"コミット粒度が規約に従っている",
			"コミット subject が Conventional Commits 形式に従う",
		];
		assert.deepEqual(deriveManualItems(items), [
			"コミット粒度が規約に従っている",
		]);
	});
});

describe("GATE_CHECKLIST_SOURCE_PATH", () => {
	it("points at a file whose checklist section yields MANUAL items", () => {
		const text = readFileSync(
			resolve(root, GATE_CHECKLIST_SOURCE_PATH),
			"utf-8",
		);
		const items = deriveManualItems(extractGateChecklist(text));
		assert.ok(
			items.length > 0,
			"expected at least one MANUAL checklist item from the deployed source file",
		);
	});
});

describe("classifyDesignRecordTiming", () => {
	it("FAILs when there is no record at all", () => {
		const result = classifyDesignRecordTiming(null, "2026-07-30T00:00:00Z");
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /no design-selection record found/);
	});

	it("SKIPs when there is no commit in range to compare against", () => {
		const result = classifyDesignRecordTiming("2026-07-30T00:00:00Z", null);
		assert.equal(result.status, "SKIP");
	});

	it("PASSes when the record predates the first commit", () => {
		const result = classifyDesignRecordTiming(
			"2026-07-30T00:00:00Z",
			"2026-07-30T12:00:00Z",
		);
		assert.equal(result.status, "PASS");
	});

	it("FAILs when the record was posted after the first commit", () => {
		const result = classifyDesignRecordTiming(
			"2026-07-30T12:00:00Z",
			"2026-07-30T00:00:00Z",
		);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /after the first commit/);
	});
});

describe("classifyDesignRecordContent", () => {
	const validRecord = [
		"前提: 実行主体が判定語を自分に有利に解釈できることを機械照合で塞ぐ。",
		"否定案: D のみ（機械検査を足さず撤回経路だけ新設する）。",
		"却下理由: designUnsettled が別プロセス用の判定である点は出力の誤りであり撤回経路では塞げない。",
		"決定: 案A を採用する。",
	].join("\n");

	it("PASSes a record with all required prefixes and enough disposition tokens", () => {
		assert.deepEqual(classifyDesignRecordContent(validRecord, 1), {
			status: "PASS",
		});
	});

	it("FAILs and lists the missing required-prefix line(s)", () => {
		const missingRejection = [
			`${DESIGN_RECORD_REQUIRED_PREFIXES[0]} x`,
			"決定: 案A を採用する。",
		].join("\n");
		const result = classifyDesignRecordContent(missingRejection, 0);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /否定案:/);
		assert.match(result.detail, /却下理由:/);
	});

	it("recognizes required prefixes under markdown heading/emphasis decoration", () => {
		const decorated = [
			"## 前提: 背景説明",
			"**否定案:** 案B",
			"### 却下理由: 理由の説明",
			"決定: 案A",
		].join("\n");
		assert.equal(classifyDesignRecordContent(decorated, 0).status, "PASS");
	});

	it("recognizes required prefixes under list markers and blockquote markers", () => {
		const listed = [
			"- 前提: 背景説明",
			"* 否定案: 案B",
			"1. 却下理由: 理由の説明",
			"> 決定: 案A",
		].join("\n");
		assert.equal(classifyDesignRecordContent(listed, 0).status, "PASS");
	});

	it("recognizes a prefix whose emphasis wraps the label alone", () => {
		const record = ["**前提**: x", "**否定案**: y", "**却下理由**: z"].join(
			"\n",
		);
		assert.equal(classifyDesignRecordContent(record, 0).status, "PASS");
	});

	it("recognizes a parenthesised qualifier on the label", () => {
		const record = [
			"前提（案A・案B 共通）: x",
			"否定案: y",
			"却下理由（外部制約）: z",
		].join("\n");
		assert.equal(classifyDesignRecordContent(record, 0).status, "PASS");
	});

	it("recognizes a full-width colon after the label", () => {
		const record = ["前提： x", "否定案： y", "却下理由： z"].join("\n");
		assert.equal(classifyDesignRecordContent(record, 0).status, "PASS");
	});

	it("recognizes decoration, qualifier and full-width colon stacked on one line", () => {
		const record = ["> - **前提（案A）**： x", "否定案: y", "却下理由: z"].join(
			"\n",
		);
		assert.equal(classifyDesignRecordContent(record, 0).status, "PASS");
	});

	it("still FAILs when the label text itself differs, not just its decoration", () => {
		const record = ["前提条件: x", "否定案: y", "却下理由: z"].join("\n");
		const result = classifyDesignRecordContent(record, 0);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /前提:/);
	});

	it("FAILs when disposition tokens appear fewer times than the enumerated option count", () => {
		const result = classifyDesignRecordContent(validRecord, 3);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /disposition tokens/);
	});

	it("does not require disposition-token coverage when optionCount is 0", () => {
		const record = DESIGN_RECORD_REQUIRED_PREFIXES.map((p) => `${p} x`).join(
			"\n",
		);
		assert.deepEqual(classifyDesignRecordContent(record, 0), {
			status: "PASS",
		});
	});

	it("PASSes when the same option's disposition word appears twice, as ordinary prose", () => {
		const record = [
			"前提: x",
			"否定案: 案2",
			"却下理由: 案2は却下する。却下理由はここに書く通り。",
			"決定: 案1を採用する。",
		].join("\n");
		assert.deepEqual(classifyDesignRecordContent(record, 2), {
			status: "PASS",
		});
	});
});

describe("DESIGN_RECORD_REQUIRED_PREFIXES / DISPOSITION_TOKENS", () => {
	it("exposes the expected prefix and disposition vocabularies", () => {
		assert.deepEqual(DESIGN_RECORD_REQUIRED_PREFIXES, [
			"前提:",
			"否定案:",
			"却下理由:",
		]);
		assert.deepEqual(DISPOSITION_TOKENS, ["採用", "却下", "保留"]);
	});
});

describe("classifySizeDirection", () => {
	const grownDelta = {
		path: ".pfdsl/bindings/x.pfdsl",
		beforeBytes: 100,
		afterBytes: 150,
		beforeLines: 10,
		afterLines: 15,
	};
	const shrunkDelta = {
		path: "docs/adr/0001-x.md",
		beforeBytes: 200,
		afterBytes: 100,
		beforeLines: 20,
		afterLines: 10,
	};

	const declared = "## 症状\n何かが肥大している。\n\nSize-Intent: shrink\n";

	it("SKIPs when the issue declares no size intent", () => {
		const result = classifySizeDirection({
			issueBody: "普通の説明。",
			deltas: [grownDelta],
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /Size-Intent/);
	});

	it("SKIPs when the issue merely mentions shrink vocabulary without declaring the intent", () => {
		const result = classifySizeDirection({
			issueBody: "#659 の案2（蒸留）を判断する前に入れておく価値がある。",
			deltas: [grownDelta],
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /Size-Intent/);
	});

	it("SKIPs when there are no tracked knowledge-artifact changes", () => {
		const result = classifySizeDirection({ issueBody: declared, deltas: [] });
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /no tracked knowledge-artifact changes/);
	});

	it("FAILs when a tracked artifact grew and no commit declares a Size-Override", () => {
		const result = classifySizeDirection({
			issueBody: declared,
			deltas: [grownDelta],
			overrideDeclared: false,
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /\+50 bytes/);
		assert.match(result.detail, /\+5 lines/);
	});

	it("PASSes growth that a commit trailer declared", () => {
		const result = classifySizeDirection({
			issueBody: declared,
			deltas: [grownDelta],
			overrideDeclared: true,
		});
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /Size-Override/);
	});

	it("PASSes when no tracked artifact grew", () => {
		const result = classifySizeDirection({
			issueBody: declared,
			deltas: [shrunkDelta],
		});
		assert.deepEqual(result, { status: "PASS" });
	});
});

// The declaration moved out of the PR body and into a commit trailer (#775):
// the terminal gate runs before the PR exists, so the body was unreadable in
// the ordinary case and editable after the fact in every other one.
describe("hasSizeOverride", () => {
	it("finds the token in a commit's trailer region", () => {
		const message = [
			"docs: grow the catalogue",
			"",
			"prose about the change",
			"",
			"Size-Override: the pattern catalogue gained an entry",
		].join("\n");
		assert.equal(hasSizeOverride(message), true);
	});

	it("ignores the token quoted in prose, the way the review record does", () => {
		const message = [
			"docs: explain the token",
			"",
			"A cycle writes Size-Override: <reason> when growth is intended.",
		].join("\n");
		assert.equal(hasSizeOverride(message), false);
	});

	it("requires a reason, so a bare token does not pass", () => {
		assert.equal(hasSizeOverride("docs: x\n\nprose\n\nSize-Override:"), false);
	});

	it("scans every commit in the range, not just the last", () => {
		const blob = [
			"docs: a\n\nprose\n\nSize-Override: intentional",
			"docs: b\n\nprose\n\nCo-Authored-By: Someone <s@example.com>",
		].join(RECORD_SEP);
		assert.equal(hasSizeOverride(blob), true);
	});

	it("is false for an empty range", () => {
		assert.equal(hasSizeOverride(""), false);
		assert.equal(hasSizeOverride(undefined), false);
	});
});

describe("formatSizeDelta", () => {
	it("signs both deltas and keeps the absolute sizes alongside", () => {
		assert.equal(
			formatSizeDelta({
				path: "docs/adr/x.md",
				beforeBytes: 30,
				afterBytes: 80,
				beforeLines: 3,
				afterLines: 8,
			}),
			"docs/adr/x.md: +50 bytes / +5 lines (30 → 80 bytes)",
		);
	});

	it("signs a shrink negatively rather than dropping the sign", () => {
		assert.match(
			formatSizeDelta({
				path: "docs/adr/x.md",
				beforeBytes: 80,
				afterBytes: 30,
				beforeLines: 8,
				afterLines: 3,
			}),
			/-50 bytes \/ -5 lines/,
		);
	});
});

describe("SIZE_INTENT_PATTERN / SIZE_TRACKED_PATTERNS / SIZE_OVERRIDE_PATTERN", () => {
	it("SIZE_INTENT_PATTERN matches a declared shrink intent at line head only", () => {
		assert.ok(SIZE_INTENT_PATTERN.test("## 症状\nSize-Intent: shrink\n"));
		assert.ok(
			!SIZE_INTENT_PATTERN.test(
				"この issue には Size-Intent: shrink とは書かない",
			),
		);
		assert.ok(!SIZE_INTENT_PATTERN.test("Size-Intent: grow"));
	});

	it("SIZE_TRACKED_PATTERNS matches bindings, ADRs, and SKILL.md", () => {
		assert.ok(
			SIZE_TRACKED_PATTERNS.some((p) => p.test(".pfdsl/bindings/x.pfdsl")),
		);
		assert.ok(
			SIZE_TRACKED_PATTERNS.some((p) => p.test("docs/adr/0020-x/README.md")),
		);
		assert.ok(
			SIZE_TRACKED_PATTERNS.some((p) =>
				p.test(".claude/skills/pfd-ops/SKILL.md"),
			),
		);
		assert.ok(
			!SIZE_TRACKED_PATTERNS.some((p) => p.test("packages/core/src/graph.ts")),
		);
	});

	it("SIZE_TRACKED_PATTERNS matches the .pfdsl companions, the largest of them (#732)", () => {
		for (const path of [
			".pfdsl/roadmap.md",
			".pfdsl/workflow.md",
			".pfdsl/runtime-pipeline.md",
			".pfdsl/review-perspectives.md",
		]) {
			assert.ok(
				SIZE_TRACKED_PATTERNS.some((p) => p.test(path)),
				`${path} should be tracked`,
			);
		}
	});

	it("SIZE_TRACKED_PATTERNS leaves the graphs themselves untracked", () => {
		// The .pfdsl files are graphs, not prose that accumulates procedure, and
		// their size moves for reasons the knowledge-artifact audit is not about.
		assert.ok(
			!SIZE_TRACKED_PATTERNS.some((p) => p.test(".pfdsl/roadmap.pfdsl")),
		);
	});

	it("SIZE_OVERRIDE_PATTERN matches a Size-Override: token line", () => {
		assert.ok(SIZE_OVERRIDE_PATTERN.test("intro\nSize-Override: reason\nmore"));
		assert.ok(!SIZE_OVERRIDE_PATTERN.test("no override mentioned here"));
	});
});

// #745: every failure of the per-issue lookup was reported as "gh CLI
// unavailable", so three different causes wore the same sentence — a typo'd
// number, gh answering with an error, and the REST fallback returning a shape
// the caller cannot parse. Only the first of those is an environment this repo
// accepts (#489), and only it may reduce the issue's checks to SKIP.
describe("classifyIssueLookupFailure", () => {
	it("SKIPs when the gh binary itself is missing", () => {
		const enoent = Object.assign(new Error("spawn gh ENOENT"), {
			code: "ENOENT",
		});
		const result = classifyIssueLookupFailure(enoent);
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /gh CLI unavailable/);
	});

	it("FAILs when gh ran and reported an error", () => {
		const result = classifyIssueLookupFailure(
			new Error("could not resolve to an Issue with the number 999999"),
		);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /999999/);
	});

	// The REST fallback path: gh is absent but a token is present, so execGh
	// answers — with the wrong shape, and JSON.parse throws. Reported as gh
	// being unavailable, this said the opposite of what happened.
	it("FAILs when the response could not be parsed", () => {
		const result = classifyIssueLookupFailure(
			new SyntaxError("Unexpected token 'N', \"No body\" is not valid JSON"),
		);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /not valid JSON/);
	});

	it("says the lookup failed rather than naming a cause it does not know", () => {
		const result = classifyIssueLookupFailure(new Error("boom"));
		assert.doesNotMatch(result.detail, /gh CLI unavailable/);
		assert.match(result.detail, /issue lookup failed/);
	});
});
