import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const skill = read(".claude/skills/pfd-ops/SKILL.md");
const architecture = read(".claude/skills/pfd-ops/references/architecture.md");
const workCycle = read(".claude/skills/pfd-ops/references/work-cycle.md");
// ADR-0039 moved this repo's own work discipline out of the bundle, so the
// rules the entry must not carry now live here rather than in work-cycle.md.
const opsBinding = read(".pfdsl/bindings/pfd-ops.md");
const activeCanonicalPaths = [
	".claude/skills/pfd-ops/SKILL.md",
	".claude/skills/pfd-ops/references/architecture.md",
	".claude/skills/pfd-ops/references/file-based-tracker-backend.md",
	".claude/skills/pfd-ops/references/github-issues-backend.md",
	".claude/skills/pfd-ops/references/work-cycle.md",
	".claude/skills/pfd-retro/SKILL.md",
	".claude/skills/pfd-ecosystem/SKILL.md",
	".claude/skills/pfd-grill/SKILL.md",
	".claude/skills/prose-mechanization-audit/SKILL.md",
	".pfdsl/roadmap.md",
	".pfdsl/workflow.md",
	".pfdsl/pipeline.md",
	".pfdsl/workflow.pfdsl",
];

describe("pfd-ops entry routing", () => {
	it("routes representative operations to one existing reference", () => {
		for (const route of [
			["作業項目への着手", "references/work-cycle.md"],
			["終端ゲート", "references/work-cycle.md"],
			["知見の振り分け", "references/work-cycle.md"],
			["GitHub Issues の操作", "references/github-issues-backend.md"],
		]) {
			assert.match(
				skill,
				new RegExp(
					`\\*\\*${route[0]}\\*\\*[^\\n]+${route[1].replaceAll(".", "\\.")}`,
				),
			);
		}
		const inspectionRoute = skill.match(
			/^- \*\*閲覧・分類・優先順位\*\*:[^\n]+/m,
		);
		assert.ok(inspectionRoute);
		assert.doesNotMatch(inspectionRoute[0], /references\/work-cycle\.md/);
		assert.match(
			inspectionRoute[0],
			/status ready <roadmap\.pfdsl> --best --json/,
		);
		assert.match(inspectionRoute[0], /採用バックエンド/);
	});

	// Two independent adoption probes read architecture.md as promising silence
	// for a repo without the GitHub Issues backend, ran the check, and got two
	// lines — the prose has to describe what the script does.
	it("describes the self-check output a non-adopting repo actually sees", () => {
		assert.doesNotMatch(architecture, /未採用のリポでは何も出ない/);
		assert.match(architecture, /未採用である旨と `--deploy` の案内が出る/);
		assert.match(architecture, /案内に従わず未採用のまま進む/);
	});

	it("keeps mandatory startup actions in the entry", () => {
		assert.match(
			skill,
			/スキル発火時に一度[^\n]+check-install-sync\.mjs --upstream/,
		);
		assert.match(
			skill,
			/同じタイミング[^\n]+\.pfdsl\/bindings\/pfd-ops\.md[^\n]+読/,
		);
	});

	it("moves low-frequency self-check and operation details out of the entry", () => {
		for (const detail of [
			"--overwrite-local-edits",
			"Possible renames",
			"版 artifact を起こす契機",
			"hook の決定を選ぶ軸",
		]) {
			assert.doesNotMatch(skill, new RegExp(detail));
		}
		assert.match(architecture, /--overwrite-local-edits/);
		assert.match(architecture, /Possible renames/);
		assert.match(workCycle, /版 artifact を起こす契機/);
		assert.match(opsBinding, /hook の決定を選ぶ軸/);
		assert.doesNotMatch(workCycle, /hook の決定を選ぶ軸/);
	});

	it("preserves the decisions needed by representative scenarios", () => {
		assert.match(workCycle, /status ready <roadmap\.pfdsl> --best --json/);
		assert.match(workCycle, /todo から wip[^\n]+done/);
		assert.match(workCycle, /terminals[^\n]+externalTerminals/);
		assert.match(
			workCycle,
			/構造的事実[^\n]+PFD[^\n]+手続き散文[^\n]+sibling companion/,
		);
		assert.match(architecture, /plugin version[^\n]+更新[^\n]+ユーザー/);
	});

	it("preserves the counterexamples that constrain operational decisions", () => {
		for (const [counterexample, decision] of [
			["criteria 未達", /wip を維持[^\n]+独立した後続作業/],
			["done 根拠なし", /done の根拠が言えない[^\n]+定義を疑う/],
			[
				"公開済みだが非ゲート版",
				/どちらにも当たらない版[^\n]+実体が公開[^\n]+起こさない/,
			],
			[
				"scaffold workflow",
				/workflow\.pfdsl[^\n]+scaffold[^\n]+登録は該当なし/,
			],
			["事故対処の道具", /個別の事故への対処[^\n]+参加者ではない/],
			["pipeline 不在", /pipeline\.pfdsl`? が存在しない[^\n]+別の PFD/],
		]) {
			assert.match(workCycle, decision, counterexample);
		}
		// The hook-decision counterexamples moved with their rule (ADR-0039).
		for (const [counterexample, decision] of [
			["deny retry", /1回の retry[^\n]+対処済み[^\n]+deny/],
			["ask retry", /payload[^\n]+ask[^\n]+deny[^\n]+retry/],
		]) {
			assert.match(opsBinding, decision, counterexample);
		}
	});

	it("has no active canonical references to removed protocol anchors", () => {
		for (const path of activeCanonicalPaths) {
			const content = read(path);
			assert.doesNotMatch(
				content,
				/pfd-ops (?:スキルの)?プロトコル|プロトコル[0-9]/,
				path,
			);
			assert.doesNotMatch(
				content,
				/SKILL\.md[^\n]+(?:運用プロトコル|成果物の門番|配置ファイルの鮮度セルフチェック)/,
				path,
			);
		}
	});
});
