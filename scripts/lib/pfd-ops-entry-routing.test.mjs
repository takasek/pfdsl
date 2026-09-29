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

function headingBody(markdown, path) {
	const lines = markdown.split("\n");
	const ancestry = [];
	let selected;
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(#{2,6}) (.+)$/.exec(lines[index]);
		if (!match) continue;
		const depth = match[1].length;
		if (selected && depth <= selected.depth) {
			return lines.slice(selected.bodyStart, index).join("\n");
		}
		ancestry.length = depth - 2;
		ancestry[depth - 2] = match[2];
		ancestry.length = depth - 1;
		if (depth === path.length + 1 && ancestry.join("\0") === path.join("\0")) {
			selected = { bodyStart: index + 1, depth };
		}
	}
	assert.ok(selected, `missing heading path: ${path.join(" > ")}`);
	return lines.slice(selected.bodyStart).join("\n");
}
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
const opsBindingHeadings = new Set(
	[...opsBinding.matchAll(/^#{2,6} (.+)$/gm)].map((match) => match[1]),
);

function namedOpsBindingReferences(markdown, sourcePath) {
	const references = [];
	for (const line of markdown.split("\n")) {
		const pathCitation = line.match(
			/\.pfdsl\/bindings\/pfd-ops\.md`?\s*(「[^」]+」(?:の「[^」]+」)*)/,
		);
		if (pathCitation) {
			for (const match of pathCitation[1].matchAll(/「([^」]+)」/g)) {
				references.push({ sourcePath, heading: match[1] });
			}
		}
		for (const match of line.matchAll(/\bbinding「([^」]+)」/g)) {
			references.push({ sourcePath, heading: match[1] });
		}
		if (sourcePath === ".pfdsl/bindings/pfd-retro.md") {
			for (const match of line.matchAll(/同節「([^」]+)」/g)) {
				references.push({ sourcePath, heading: match[1] });
			}
		}
		if (sourcePath === ".pfdsl/bindings/pfd-ops.md") {
			for (const match of line.matchAll(
				/(?:本節末尾の|本節の|本節|本 binding の|上の|同節の?)「([^」]+)」/g,
			)) {
				references.push({ sourcePath, heading: match[1] });
			}
		}
	}
	return references;
}

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

	it("selects the binding self-check body before running the default check", () => {
		const startup = headingBody(skill, ["発火時の必須セルフチェック"]);
		const bindingLookup = startup.indexOf(".pfdsl/bindings/pfd-ops.md");
		const bodyRead = startup.indexOf("本文を読んでから実行");
		const defaultCheck = startup.indexOf("check-install-sync.mjs --upstream");
		assert.ok(bindingLookup >= 0 && bodyRead > bindingLookup);
		assert.ok(defaultCheck > bodyRead);
		assert.match(startup, /本文に別の実行パスが指定されていない場合/);
		assert.match(
			startup,
			/node \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/pfd-ops\/scripts\/check-install-sync\.mjs --upstream/,
		);
		assert.match(
			startup,
			/repo-local の `\.claude\/skills\/pfd-ops\/scripts\/check-install-sync\.mjs`/,
		);
		assert.match(startup, /現在読んでいるこのファイルの所在から相対/);

		const upstreamSelfCheck = headingBody(opsBinding, [
			"配置ファイル鮮度セルフチェックをこのリポでは repo-local 版で実行する",
		]);
		assert.match(
			upstreamSelfCheck,
			/node \.claude\/skills\/pfd-ops\/scripts\/check-install-sync\.mjs --upstream/,
		);
		assert.doesNotMatch(upstreamSelfCheck, /CLAUDE_PLUGIN_ROOT/);
	});

	it("keeps design prerequisites in the body selected for design", () => {
		const routing = headingBody(skill, ["リポ固有の手順を該当見出しで選ぶ"]);
		assert.match(routing, /見出し一覧.*階層/);
		assert.match(routing, /該当する本文だけを読む/);
		assert.match(routing, /見出し名の列挙だけで本文を省略しない/);
		const selectedDesign = headingBody(opsBinding, [
			"ワークサイクルの追加手順",
			"適用点 1 で採用案と対案を比較して設計を決める",
		]);
		assert.match(selectedDesign, /一次記録.*設計判断履歴.*現行のコード・仕様/);
		assert.match(selectedDesign, /サイクルの範囲.*設計が確定するまで/);
	});

	it("resolves active named binding references to existing headings", () => {
		const activeBindingDocuments = [
			".pfdsl/workflow.md",
			".pfdsl/roadmap.md",
			".pfdsl/bindings/pfd-retro.md",
			".pfdsl/bindings/pfd-ops.md",
		];
		for (const sourcePath of activeBindingDocuments) {
			for (const reference of namedOpsBindingReferences(
				read(sourcePath),
				sourcePath,
			)) {
				assert.ok(
					opsBindingHeadings.has(reference.heading),
					`${reference.sourcePath} references missing pfd-ops binding heading: ${reference.heading}`,
				);
			}
		}
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

	// #1239: stage zero named the terminal-audit contract but not how one audit
	// run is frozen, so an adopting repo could not place its run management.
	it("closes the promotion categories over audit-run management", () => {
		const stageZero = architecture.match(/\*\*0段目[\s\S]+?\n\*\*1段目/);
		assert.ok(stageZero);
		const categoryOne = stageZero[0].match(/^- \*\*区分 i —[^\n]+/m);
		const categoryThree = stageZero[0].match(/^- \*\*区分 iii —[^\n]+/m);
		assert.ok(categoryOne);
		assert.ok(categoryThree);
		assert.match(categoryOne[0], /終端監査の契約[^\n]*監査対象/);
		assert.match(categoryThree[0], /実行 ID[^\n]+cutoff[^\n]+checkpoint/);
		// Only audit runs were clarified; widening iii to work runs would move
		// backend-integration duties (category ii) into the binding.
		assert.match(categoryThree[0], /1回の監査の実行管理/);
		assert.doesNotMatch(categoryThree[0], /作業[^、。]*実行/);
		assert.match(stageZero[0], /ライフサイクル監査[^\n]+区分 ii/);
		// Category ii also includes non-audit backend procedures, so the
		// target-versus-run explanation must stay scoped to audit items.
		assert.match(stageZero[0], /^監査に関わる区分 i・ii の項目が定めるのは/m);
		assert.doesNotMatch(stageZero[0], /^区分 i・ii が定めるのは/m);

		const opsIntro = opsBinding.split(/\n## /)[0];
		assert.doesNotMatch(opsIntro, /一般に有効/);
		assert.match(opsIntro, /昇格先の判定ルール[^\n]+0段目/);
		assert.doesNotMatch(opsBinding, /Claude 向け指示の置き場/);

		const routeOne = read(".pfdsl/workflow.md").match(
			/^1\. \*\*即時ルール化\*\*[^\n]+/m,
		);
		assert.ok(routeOne);
		assert.match(routeOne[0], /昇格先の判定ルール[^\n]+0段目/);

		const runContract = read(".pfdsl/bindings/pfd-retro.md").match(
			/\n## 1 回の実行契約\n\n([^\n]+)/,
		);
		assert.ok(runContract);
		assert.match(runContract[1], /区分 iii/);
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
