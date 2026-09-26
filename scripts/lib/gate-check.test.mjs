import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import * as gateCheck from "./gate-check.mjs";
import {
	AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE,
	buildSiblingConsumedMap,
	classifyAuditIssuesFlowResult,
	classifyChangedFilesByModeling,
	classifyIssueLookupFailure,
	classifyOutputArtifactStatus,
	collectModeledLocations,
	derivePackageLayers,
	diffNewTerminals,
	diffReadySets,
	formatGateTable,
	formatRunTreeLine,
	formatSizeDelta,
	hasStatusChange,
	lintCommitSubjects,
	matchesTrigger,
	parseAuditExternalTerminals,
	parseAuditTerminals,
	parseCommitLogLines,
	parseInputConsumedArtifacts,
	partitionNewTerminals,
	SIZE_TRACKED_PATTERNS,
	sharesSiblingIdNamespace,
	statusChangedForArtifact,
	unionCommitLogEntries,
	VSCODE_EXT_TRIGGER,
	wipTransitionDetected,
} from "./gate-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
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

	it("checks format independently of language or quoting", () => {
		for (const subject of [
			"fix(cli): ラベルを修正する",
			"fix(cli): corregir etiquetas",
			"fix(cli): исправить метки",
			"docs(skill): clarify `前回` refers to 直近のログ",
			'feat(retro): add "保留した違和感の想起" to the catalog',
			"docs(ops): note 人々 here",
			"docs(ops): note ﾊﾝｶｸ here",
		]) {
			assert.equal(lintCommitSubjects([subject])[0].ok, true, subject);
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

describe("parseInputConsumedArtifacts", () => {
	it("collects artifacts consumed by a normal input edge", () => {
		const json = JSON.stringify({
			ok: true,
			edges: [
				{ kind: "input", artifact: "skill_template", process: "gen_skill" },
				{ kind: "output", process: "gen_skill", artifact: "plugin_bundle" },
			],
		});
		assert.deepEqual(parseInputConsumedArtifacts(json), ["skill_template"]);
	});

	it("ignores feedback edges, matching audit-terminal semantics", () => {
		// `graph io`'s terminals are the spec's audit-terminal (§15.11): an
		// artifact consumed only via `>>?` stays terminal. A sibling's feedback
		// edge must not rescue it either, or the same artifact would be classed
		// differently depending on which file its feedback consumer sits in.
		const json = JSON.stringify({
			ok: true,
			edges: [
				{ kind: "feedback", artifact: "review_findings", process: "distill" },
			],
		});
		assert.deepEqual(parseInputConsumedArtifacts(json), []);
	});

	it("deduplicates artifacts consumed by more than one process", () => {
		const json = JSON.stringify({
			ok: true,
			edges: [
				{ kind: "input", artifact: "feature_samples", process: "gen_skill" },
				{ kind: "input", artifact: "feature_samples", process: "gen_plugin" },
			],
		});
		assert.deepEqual(parseInputConsumedArtifacts(json), ["feature_samples"]);
	});

	it("returns an empty array when the graph failed to parse", () => {
		const json = JSON.stringify({ ok: false, diagnostics: [] });
		assert.deepEqual(parseInputConsumedArtifacts(json), []);
	});

	it("returns an empty array for non-JSON input", () => {
		assert.deepEqual(parseInputConsumedArtifacts("not json"), []);
	});
});

describe("sharesSiblingIdNamespace", () => {
	it("holds for the operational PFD set, where same id means same artifact", () => {
		assert.equal(sharesSiblingIdNamespace(".pfdsl"), true);
	});

	it("does not hold for docs/samples, whose diagrams are mutually unrelated", () => {
		// Real collision at the time of writing: docs/samples/10-layout-tb.pfdsl
		// has `code` as a terminal while docs/samples/02-feedback.pfdsl consumes
		// an unrelated `code`. Composing those would file a genuine gatekeeper
		// violation under "consumed in a sibling graph".
		assert.equal(sharesSiblingIdNamespace("docs/samples"), false);
	});

	it("does not hold for the repo root", () => {
		assert.equal(sharesSiblingIdNamespace("."), false);
	});
});

describe("buildSiblingConsumedMap", () => {
	it("gives each file the union of every other file's consumed artifacts", () => {
		const result = buildSiblingConsumedMap([
			["a.pfdsl", ["x", "y"]],
			["b.pfdsl", ["y", "z"]],
			["c.pfdsl", ["w"]],
		]);
		assert.deepEqual(result.get("a.pfdsl"), ["y", "z", "w"]);
		assert.deepEqual(result.get("b.pfdsl"), ["x", "y", "w"]);
		assert.deepEqual(result.get("c.pfdsl"), ["x", "y", "z"]);
	});

	it("excludes the file's own consumers, so a self-consumed artifact stays terminal", () => {
		const result = buildSiblingConsumedMap([["only.pfdsl", ["x"]]]);
		assert.deepEqual(result.get("only.pfdsl"), []);
	});

	it("returns an empty map for no files", () => {
		assert.equal(buildSiblingConsumedMap([]).size, 0);
	});
});

describe("partitionNewTerminals", () => {
	it("splits terminals a sibling consumes from the genuinely terminal ones", () => {
		assert.deepEqual(
			partitionNewTerminals(
				["skill_template", "article"],
				["skill_template", "quality_guide"],
			),
			{ terminal: ["article"], consumedInSibling: ["skill_template"] },
		);
	});

	it("keeps everything terminal when no sibling consumes any of them", () => {
		assert.deepEqual(partitionNewTerminals(["article"], []), {
			terminal: ["article"],
			consumedInSibling: [],
		});
	});

	it("preserves the input order within each partition", () => {
		assert.deepEqual(partitionNewTerminals(["a", "b", "c", "d"], ["c", "a"]), {
			terminal: ["b", "d"],
			consumedInSibling: ["a", "c"],
		});
	});

	it("returns empty partitions for an empty terminal list", () => {
		assert.deepEqual(partitionNewTerminals([], ["a"]), {
			terminal: [],
			consumedInSibling: [],
		});
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

describe("manual gate guidance", () => {
	it("points readers to the canonical pre-PR and post-PR checklist sections", () => {
		assert.deepEqual(gateCheck.MANUAL_GUIDANCE_LINES, [
			"MANUAL: Before creating the PR, review `3. 反映 — 終端ゲート` in `.claude/skills/pfd-ops/references/work-cycle.md`.",
			"MANUAL: After creating the PR, review the `PR 作成後` items in the same section.",
		]);
	});

	it("does not export the retired prose parser or classifiers", () => {
		assert.equal("extractGateChecklist" in gateCheck, false);
		assert.equal("deriveManualItems" in gateCheck, false);
		assert.equal("partitionManualItemsByPhase" in gateCheck, false);
	});

	it("keeps the CLI wired to the shared finalizer exactly once", () => {
		const source = readFileSync(
			resolve(root, "scripts/gate-check.mjs"),
			"utf-8",
		);
		assert.equal(
			source.match(/^finishGateCheck\(results, \{ issueNumbers \}\);$/gm)
				?.length,
			1,
		);
	});

	it("prints the heading and both guidance lines once before exiting on FAIL", () => {
		assert.equal(typeof gateCheck.finishGateCheck, "function");
		const lines = [];
		const exitCodes = [];
		gateCheck.finishGateCheck([{ name: "mechanical check", status: "FAIL" }], {
			log: (line) => lines.push(line),
			exit: (code) => exitCodes.push(code),
		});
		assert.deepEqual(lines, [
			"\nManual checks:",
			...gateCheck.MANUAL_GUIDANCE_LINES.map((line) => `  ${line}`),
			"  MANUAL: no --issue given; no issue review is implied. Pass every target explicitly for terminal review.",
		]);
		assert.deepEqual(exitCodes, [1]);
	});
});

describe("derivePackageLayers", () => {
	it("names each package under packages/ the branch touched, once", () => {
		assert.deepEqual(
			derivePackageLayers([
				"packages/core/src/graph.ts",
				"packages/core/src/parse.ts",
				"packages/cli/src/index.ts",
			]),
			["cli", "core"],
		);
	});

	it("ignores paths outside packages/", () => {
		assert.deepEqual(
			derivePackageLayers(["scripts/gate-check.mjs", ".pfdsl/roadmap.md"]),
			[],
		);
	});

	it("ignores a file sitting directly in packages/", () => {
		assert.deepEqual(derivePackageLayers(["packages/README.md"]), []);
	});

	it("is empty for an empty diff", () => {
		assert.deepEqual(derivePackageLayers([]), []);
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

describe("SIZE_TRACKED_PATTERNS", () => {
	it("matches bindings, ADRs, and SKILL.md", () => {
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

	it("matches the .pfdsl companions, the largest of them (#732)", () => {
		for (const path of [
			".pfdsl/roadmap.md",
			".pfdsl/workflow.md",
			".pfdsl/pipeline.md",
			".pfdsl/review-perspectives.md",
		]) {
			assert.ok(
				SIZE_TRACKED_PATTERNS.some((p) => p.test(path)),
				`${path} should be tracked`,
			);
		}
	});

	it("leaves the graphs themselves untracked", () => {
		// The .pfdsl files are graphs, not prose that accumulates procedure, and
		// their size moves for reasons the knowledge-artifact audit is not about.
		assert.ok(
			!SIZE_TRACKED_PATTERNS.some((p) => p.test(".pfdsl/roadmap.pfdsl")),
		);
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

// #834: the cycle window — base commits this tree currently lacks, unioned
// with base commits that landed at/after the branch's first commit. These two
// pure helpers turn `git log --format=%h%x09%s` output into records and merge
// two such lists; collectCycleWindow (gate-check-steps.mjs) is what actually
// runs the three git calls this shape comes from.
describe("parseCommitLogLines", () => {
	it("parses sha/subject pairs, one per line", () => {
		assert.deepEqual(
			parseCommitLogLines("76ccc2c5\tfix(gate-check): note a mismatch\n"),
			[{ sha: "76ccc2c5", subject: "fix(gate-check): note a mismatch" }],
		);
	});

	it("ignores blank lines", () => {
		assert.deepEqual(
			parseCommitLogLines("abc123\tfeat: a\n\ndef456\tfix: b\n"),
			[
				{ sha: "abc123", subject: "feat: a" },
				{ sha: "def456", subject: "fix: b" },
			],
		);
	});

	it("splits on the first tab only, so a subject carrying its own tab survives whole", () => {
		assert.deepEqual(parseCommitLogLines("abc123\tfeat: a\tb\n"), [
			{ sha: "abc123", subject: "feat: a\tb" },
		]);
	});

	it("returns an empty array for empty input", () => {
		assert.deepEqual(parseCommitLogLines(""), []);
		assert.deepEqual(parseCommitLogLines("\n"), []);
	});
});

describe("unionCommitLogEntries", () => {
	it("de-duplicates by sha, preserving first-seen order", () => {
		const a = [
			{ sha: "a1", subject: "one" },
			{ sha: "a2", subject: "two" },
		];
		const b = [
			{ sha: "a2", subject: "two (duplicate)" },
			{ sha: "a3", subject: "three" },
		];
		assert.deepEqual(unionCommitLogEntries(a, b), [
			{ sha: "a1", subject: "one" },
			{ sha: "a2", subject: "two" },
			{ sha: "a3", subject: "three" },
		]);
	});

	it("returns the first list unchanged when the second is empty", () => {
		const a = [{ sha: "a1", subject: "one" }];
		assert.deepEqual(unionCommitLogEntries(a, []), a);
	});

	it("returns the second list when the first is empty", () => {
		const b = [{ sha: "b1", subject: "one" }];
		assert.deepEqual(unionCommitLogEntries([], b), b);
	});

	it("returns an empty array when both are empty", () => {
		assert.deepEqual(unionCommitLogEntries([], []), []);
	});
});

describe("formatRunTreeLine", () => {
	it("names the main checkout when root equals mainRoot", () => {
		const line = formatRunTreeLine({
			root: "/repo",
			mainRoot: "/repo",
			branch: "main",
		});
		assert.match(line, /main checkout/);
		assert.match(line, /main/);
	});

	it("names a linked worktree when root differs from mainRoot", () => {
		const line = formatRunTreeLine({
			root: "/repo/.claude/worktrees/feature-x",
			mainRoot: "/repo",
			branch: "feature-x",
		});
		assert.match(line, /linked worktree/);
		assert.match(line, /feature-x/);
	});

	it("stays readable when branch is null (unresolved or detached HEAD)", () => {
		const line = formatRunTreeLine({
			root: "/repo",
			mainRoot: "/repo",
			branch: null,
		});
		assert.doesNotMatch(line, /null/);
		assert.match(line, /main checkout/);
	});
});

describe("collectModeledLocations", () => {
	// Stands in for the injected @pfdsl/core resolver: the same two decisions
	// (URLs name nothing in the tree; everything else resolves against the
	// file's own directory) with none of the build dependency. What core owns
	// is tested in core; what is asserted here is this function's own job —
	// which nodes it visits, and what it does with each resolution.
	// The trailing slash is stripped here because path resolution strips it,
	// and putting it back is this function's job, not the resolver's.
	const resolveLocation = (file, location, basePath) =>
		location.includes("://")
			? null
			: posix
					.join(posix.dirname(file), basePath ?? ".", location)
					.replace(/\/$/, "");

	it("respects the actual workflow's generic and backend layer boundary (#1082)", () => {
		const file = ".pfdsl/workflow.pfdsl";
		const source = readFileSync(resolve(root, file), "utf8");
		const frontmatter = parseYaml(source.split(/^---\s*$/m)[1]);
		const locations = collectModeledLocations(
			[{ file, frontmatter }],
			resolveLocation,
		);
		const expected = [
			["references/github-issues-backend.md", "ops_skill_l3"],
			["SKILL.md", "ops_skill_general"],
			["references/work-cycle.md", "ops_skill_general"],
			["references/architecture.md", "ops_skill_general"],
			// Both backend presets are maintained as one L3 artifact, whichever of
			// them this repo adopts (#1227).
			["references/file-based-tracker-backend.md", "ops_skill_l3"],
		];
		const skillRoot = resolve(root, ".claude/skills/pfd-ops");
		const actualFiles = [
			...readdirSync(skillRoot).filter((name) => name === "SKILL.md"),
			...readdirSync(resolve(skillRoot, "references"))
				.filter((name) => name.endsWith(".md"))
				.map((name) => `references/${name}`),
		];
		assert.deepEqual(
			actualFiles.sort(),
			expected.map(([path]) => path).sort(),
			"Classify every protocol/reference file as generic, backend, or intentionally outside this workflow when adding, moving, or splitting it.",
		);
		for (const [path, id] of expected) {
			const changedPath = `.claude/skills/pfd-ops/${path}`;
			assert.deepEqual(
				classifyChangedFilesByModeling([changedPath], locations),
				id === null
					? { modeled: [], unmodeled: [changedPath] }
					: {
							modeled: [{ path: changedPath, models: [{ file, id }] }],
							unmodeled: [],
						},
				path,
			);
		}
	});

	const analyzed = [
		{
			file: ".pfdsl/workflow.pfdsl",
			frontmatter: {
				artifact: {
					spec: { location: "../docs/spec/spec.md" },
					roadmap_pfdsl: { location: "roadmap.pfdsl" },
					issues: { location: "https://github.com/takasek/pfdsl/issues" },
					unplaced: { label: "no location at all" },
				},
				process: {
					flow_sync: {
						location: [
							"../scripts/pfdsl/",
							"../.github/workflows/pfdsl-sweep-completed-chains.yml",
						],
					},
				},
			},
		},
	];

	it("resolves companion-relative locations against the .pfdsl directory", () => {
		const modeled = collectModeledLocations(analyzed, resolveLocation);
		assert.deepEqual(
			modeled.find((m) => m.id === "spec"),
			{ path: "docs/spec/spec.md", file: ".pfdsl/workflow.pfdsl", id: "spec" },
		);
	});

	it("keeps a sibling location inside the .pfdsl directory", () => {
		const modeled = collectModeledLocations(analyzed, resolveLocation);
		assert.equal(
			modeled.find((m) => m.id === "roadmap_pfdsl").path,
			".pfdsl/roadmap.pfdsl",
		);
	});

	it("drops URLs, which name nothing in the tree", () => {
		assert.ok(
			!collectModeledLocations(analyzed, resolveLocation).some(
				(m) => m.id === "issues",
			),
		);
	});

	it("takes processes as well as artifacts, and every element of a list location", () => {
		const paths = collectModeledLocations(analyzed, resolveLocation)
			.filter((m) => m.id === "flow_sync")
			.map((m) => m.path);
		assert.deepEqual(paths, [
			"scripts/pfdsl/",
			".github/workflows/pfdsl-sweep-completed-chains.yml",
		]);
	});

	it("skips nodes that declare no location", () => {
		assert.ok(
			!collectModeledLocations(analyzed, resolveLocation).some(
				(m) => m.id === "unplaced",
			),
		);
	});
});

describe("classifyChangedFilesByModeling", () => {
	const modeled = [
		{ path: "docs/spec/spec.md", file: ".pfdsl/workflow.pfdsl", id: "spec" },
		{ path: "scripts/pfdsl/", file: ".pfdsl/workflow.pfdsl", id: "flow_sync" },
	];

	it("matches an exact file location", () => {
		const result = classifyChangedFilesByModeling(
			["docs/spec/spec.md"],
			modeled,
		);
		assert.deepEqual(result.modeled, [
			{
				path: "docs/spec/spec.md",
				models: [{ file: ".pfdsl/workflow.pfdsl", id: "spec" }],
			},
		]);
		assert.deepEqual(result.unmodeled, []);
	});

	it("matches a file under a directory location", () => {
		const result = classifyChangedFilesByModeling(
			["scripts/pfdsl/audit-issues-flow.mjs"],
			modeled,
		);
		assert.equal(result.modeled.length, 1);
		assert.deepEqual(result.modeled[0].models, [
			{ file: ".pfdsl/workflow.pfdsl", id: "flow_sync" },
		]);
	});

	// The whole point of #778: a change no adopted PFD models must be visible as
	// such, so that the gate item's "N/A" can be read as out-of-scope rather than
	// as a judgment someone made.
	it("reports a path no location covers as unmodeled", () => {
		const result = classifyChangedFilesByModeling(
			["scripts/gate-check.mjs"],
			modeled,
		);
		assert.deepEqual(result.unmodeled, ["scripts/gate-check.mjs"]);
		assert.deepEqual(result.modeled, []);
	});

	it("does not let a directory location match a sibling with the same prefix", () => {
		const result = classifyChangedFilesByModeling(
			["scripts/pfdsl-extra.mjs"],
			modeled,
		);
		assert.deepEqual(result.unmodeled, ["scripts/pfdsl-extra.mjs"]);
	});

	it("lists every node modeling the same path", () => {
		const result = classifyChangedFilesByModeling(
			["docs/spec/spec.md"],
			[
				...modeled,
				{
					path: "docs/spec/spec.md",
					file: ".pfdsl/pipeline.pfdsl",
					id: "spec",
				},
			],
		);
		assert.deepEqual(result.modeled[0].models, [
			{ file: ".pfdsl/workflow.pfdsl", id: "spec" },
			{ file: ".pfdsl/pipeline.pfdsl", id: "spec" },
		]);
	});
});
