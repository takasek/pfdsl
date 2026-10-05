import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const skill = read(".claude/skills/pfd-ops/SKILL.md");
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
	it("keeps work-cycle CLI arguments and graph result keys", () => {
		assert.ok(workCycle.includes("status ready <roadmap.pfdsl> --json"));
		assert.match(workCycle, /\bterminals\b/);
		assert.match(workCycle, /\bexternalTerminals\b/);
	});
	it("keeps the plugin self-check and upstream override command arguments", () => {
		assert.match(
			skill,
			/node \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/pfd-ops\/scripts\/check-install-sync\.mjs --upstream/,
		);
		assert.match(
			opsBinding,
			/node \.claude\/skills\/pfd-ops\/scripts\/check-install-sync\.mjs --upstream/,
		);
		assert.ok(
			read(".claude/skills/pfd-ops/scripts/check-install-sync.mjs").length > 0,
		);
	});
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
		assert.match(inspectionRoute[0], /status ready <roadmap\.pfdsl> --json/);
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
