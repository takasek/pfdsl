import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	parseIssueArtifacts,
	computeFindings,
	applyFixes,
	applyClosedInFlowFixes,
	computeLabelFindings,
} from "../../.claude/skills/pfd-ops/lib/issues-flow-audit.mjs";
import { parseDocument } from "./yaml-require.mjs";

// ---------------------------------------------------------------------------
// parseIssueArtifacts
// ---------------------------------------------------------------------------

describe("parseIssueArtifacts", () => {
	it("returns empty array when no artifact key", () => {
		const result = parseIssueArtifacts({});
		assert.deepEqual(result, []);
	});

	it("ignores non-iN_ artifacts", () => {
		const fm = {
			artifact: {
				spec_v006: { label: "Spec", status: "done" },
				cli_tool: { label: "CLI", status: "done" },
				findings_r12: { label: "Findings", status: "done" },
			},
		};
		const result = parseIssueArtifacts(fm);
		assert.deepEqual(result, []);
	});

	it("parses iN_ artifacts and extracts issueNumber", () => {
		const fm = {
			artifact: {
				i4_lint_checker: { label: "Lint", status: "todo", tags: ["priority:high"] },
				i11_portable_skill: { label: "Skill", status: "todo", tags: ["priority:high"] },
			},
		};
		const result = parseIssueArtifacts(fm);
		assert.equal(result.length, 2);
		assert.equal(result[0].id, "i4_lint_checker");
		assert.equal(result[0].issueNumber, 4);
		assert.equal(result[0].status, "todo");
		assert.deepEqual(result[0].priorities, ["priority:high"]);
		assert.equal(result[1].issueNumber, 11);
	});

	it("updatedAt and priorities default correctly when fields absent; updatedAt extracted when present", () => {
		const absent = parseIssueArtifacts({ artifact: { i5_hierarchy_spec: { label: "H", status: "todo" } } });
		assert.equal(absent[0].updatedAt, undefined);
		assert.deepEqual(absent[0].priorities, []);

		const present = parseIssueArtifacts({ artifact: { i5_hierarchy_spec: { label: "H", status: "todo", updated_at: "2026-06-01T00:00:00Z" } } });
		assert.equal(present[0].updatedAt, "2026-06-01T00:00:00Z");
	});

	it("priorities filters only priority: tags and sorts them", () => {
		const fm = {
			artifact: {
				i5_hierarchy_spec: {
					label: "H",
					status: "todo",
					tags: ["foo", "priority:high", "priority:low", "bar"],
				},
			},
		};
		const result = parseIssueArtifacts(fm);
		assert.deepEqual(result[0].priorities, ["priority:high", "priority:low"]);
	});

	it("mixes iN_ and non-iN_ artifacts correctly", () => {
		const fm = {
			artifact: {
				spec_v006: { label: "Spec", status: "done" },
				i18_issue_sync: { label: "Sync", status: "todo", tags: ["priority:high"] },
				cli_tool: { label: "CLI", status: "done" },
			},
		};
		const result = parseIssueArtifacts(fm);
		assert.equal(result.length, 1);
		assert.equal(result[0].issueNumber, 18);
	});
});

// ---------------------------------------------------------------------------
// computeFindings
// ---------------------------------------------------------------------------

describe("computeFindings", () => {
	// Helper: open issue with matching artifact but no flow:managed label
	it("missing_label: open issue with artifact but no flow:managed", () => {
		const artifacts = [{ id: "i5_hierarchy_spec", issueNumber: 5, status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: [], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		const f = findings.find((f) => f.type === "missing_label");
		assert.ok(f);
		assert.equal(f.issueNumber, 5);
		assert.equal(f.artifactId, "i5_hierarchy_spec");
		assert.equal(f.fixVia, "github");
	});

	it("no missing_label when flow:managed is present", () => {
		const artifacts = [{ id: "i5_hierarchy_spec", issueNumber: 5, status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		assert.ok(!findings.find((f) => f.type === "missing_label"));
	});

	it("exempt_conflict: open issue with artifact AND flow:exempt label", () => {
		const artifacts = [{ id: "i5_hierarchy_spec", issueNumber: 5, status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed", "flow:exempt"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		const f = findings.find((f) => f.type === "exempt_conflict");
		assert.ok(f);
		assert.equal(f.fixVia, undefined);
	});

	it("missing_artifact: open issue with flow:managed but no artifact", () => {
		const issues = [{ number: 99, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings([], issues);
		const f = findings.find((f) => f.type === "missing_artifact");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(f.artifactId, undefined);
		assert.equal(f.fixVia, undefined);
	});

	it("untriaged: open issue with no artifact and no flow labels", () => {
		const issues = [{ number: 99, state: "OPEN", labels: [], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings([], issues);
		const f = findings.find((f) => f.type === "untriaged");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(f.fixVia, undefined);
	});

	it("no finding: open issue with flow:exempt and no artifact", () => {
		const issues = [{ number: 99, state: "OPEN", labels: ["flow:exempt"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings([], issues);
		assert.equal(findings.length, 0);
	});

	it("unknown_issue: artifact whose issueNumber is not in issues list", () => {
		const artifacts = [{ id: "i99_foo", issueNumber: 99, status: "todo", updatedAt: undefined, priorities: [] }];
		const findings = computeFindings(artifacts, []);
		const f = findings.find((f) => f.type === "unknown_issue");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(f.artifactId, "i99_foo");
		assert.equal(f.fixVia, undefined);
	});

	it("closed_in_flow: artifact for closed issue with status !== done", () => {
		const artifacts = [{ id: "i5_foo", issueNumber: 5, status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "CLOSED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		const f = findings.find((f) => f.type === "closed_in_flow");
		assert.ok(f);
		assert.equal(f.fixVia, "flow");
		assert.ok(f.detail.includes("delete the chain"), "detail should guide cleanup");
	});

	it("closed_in_flow: artifact for closed issue with status done also emits finding", () => {
		const artifacts = [{ id: "i5_foo", issueNumber: 5, status: "done", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "CLOSED", labels: ["flow:managed"], updatedAt: "2026-02-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		const matching = findings.filter((f) => f.issueNumber === 5);
		assert.equal(matching.length, 1);
		assert.equal(matching[0].type, "closed_in_flow");
		assert.equal(matching[0].fixVia, "flow");
		assert.ok(matching[0].detail.includes("delete the chain"), "detail should guide cleanup");
	});

	it("stale_updated_at: open issue with mismatched updatedAt", () => {
		const artifacts = [{ id: "i5_foo", issueNumber: 5, status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		const f = findings.find((f) => f.type === "stale_updated_at");
		assert.ok(f);
		assert.equal(f.fixVia, "file");
		assert.ok(f.detail.includes("2026-01-01T00:00:00Z"));
		assert.ok(f.detail.includes("2026-06-01T00:00:00Z"));
	});

	it("stale_updated_at: artifact missing updatedAt shows (none)", () => {
		const artifacts = [{ id: "i5_foo", issueNumber: 5, status: "todo", updatedAt: undefined, priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		const f = findings.find((f) => f.type === "stale_updated_at");
		assert.ok(f);
		assert.ok(f.detail.includes("(none)"));
	});

	it("no stale_updated_at when updatedAt matches", () => {
		const artifacts = [{ id: "i5_foo", issueNumber: 5, status: "todo", updatedAt: "2026-06-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		assert.ok(!findings.find((f) => f.type === "stale_updated_at"));
	});

	it("priority_drift: issue priority labels differ from artifact priorities", () => {
		const artifacts = [{ id: "i5_foo", issueNumber: 5, status: "todo", updatedAt: "2026-06-01T00:00:00Z", priorities: ["priority:high"] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed", "priority:low"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		const f = findings.find((f) => f.type === "priority_drift");
		assert.ok(f);
		assert.equal(f.fixVia, "file");
	});

	it("no priority_drift when both have no priority labels", () => {
		const artifacts = [{ id: "i5_foo", issueNumber: 5, status: "todo", updatedAt: "2026-06-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		assert.ok(!findings.find((f) => f.type === "priority_drift"));
	});

	it("one pair can yield multiple findings", () => {
		// stale_updated_at + priority_drift + missing_label all at once
		const artifacts = [{ id: "i5_foo", issueNumber: 5, status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: ["priority:high"] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["priority:low"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(artifacts, issues);
		assert.ok(findings.find((f) => f.type === "missing_label"));
		assert.ok(findings.find((f) => f.type === "stale_updated_at"));
		assert.ok(findings.find((f) => f.type === "priority_drift"));
	});

	it("findings are ordered by issueNumber ascending", () => {
		const artifacts = [
			{ id: "i10_foo", issueNumber: 10, status: "todo", updatedAt: undefined, priorities: [] },
			{ id: "i3_bar", issueNumber: 3, status: "todo", updatedAt: undefined, priorities: [] },
		];
		const issues = [
			{ number: 10, state: "OPEN", labels: [], updatedAt: "2026-06-01T00:00:00Z" },
			{ number: 3, state: "OPEN", labels: [], updatedAt: "2026-06-01T00:00:00Z" },
		];
		const findings = computeFindings(artifacts, issues);
		const nums = findings.map((f) => f.issueNumber);
		// all 3s should come before 10s
		const first10 = nums.indexOf(10);
		const last3 = nums.lastIndexOf(3);
		assert.ok(last3 < first10 || first10 === -1);
	});
});

// ---------------------------------------------------------------------------
// applyFixes
// ---------------------------------------------------------------------------

describe("applyFixes", () => {
	it("round-trip: preserves double-quoted label and adds updated_at", () => {
		const yaml = `artifact:
  i5_hierarchy_spec:
    label: "階層PFD仕様案 (#5)"
    status: todo
  i6_presets_spec:
    label: "共有プリセット仕様案 (#6)"
    status: todo
`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "stale_updated_at",
				issueNumber: 6,
				artifactId: "i6_presets_spec",
				detail: "artifact: (none), issue: 2026-06-01T00:00:00Z",
				fixVia: "file",
			},
		];
		const issuesByNumber = new Map([
			[6, { number: 6, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }],
		]);
		applyFixes(doc, findings, issuesByNumber);
		const out = doc.toString();
		// quoted label preserved verbatim
		assert.ok(out.includes('"階層PFD仕様案 (#5)"'), "quoted label should be preserved");
		// updated_at added
		assert.ok(out.includes("updated_at: 2026-06-01T00:00:00Z"), "updated_at should be added");
	});

	it("priority_drift: replaces priority tags, preserves non-priority tags", () => {
		const yaml = `artifact:
  i5_foo:
    label: Foo
    status: todo
    tags:
      - priority:high
      - foo
`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "priority_drift",
				issueNumber: 5,
				artifactId: "i5_foo",
				detail: "artifact: [priority:high], issue: [priority:low]",
				fixVia: "file",
			},
		];
		const issuesByNumber = new Map([
			[5, { number: 5, state: "OPEN", labels: ["flow:managed", "priority:low"], updatedAt: "2026-06-01T00:00:00Z" }],
		]);
		applyFixes(doc, findings, issuesByNumber);
		const obj = doc.toJS();
		assert.deepEqual(obj.artifact.i5_foo.tags, ["foo", "priority:low"]);
	});

	it("priority_drift: removing last tag deletes the key", () => {
		const yaml = `artifact:
  i5_foo:
    label: Foo
    status: todo
    tags:
      - priority:high
`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "priority_drift",
				issueNumber: 5,
				artifactId: "i5_foo",
				detail: "artifact: [priority:high], issue: []",
				fixVia: "file",
			},
		];
		// issue has no priority labels
		const issuesByNumber = new Map([
			[5, { number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }],
		]);
		applyFixes(doc, findings, issuesByNumber);
		const obj = doc.toJS();
		assert.equal(obj.artifact.i5_foo.tags, undefined);
	});

	it("ignores findings without fixVia: 'file'", () => {
		const yaml = `artifact:
  i5_foo:
    label: Foo
    status: todo
`;
		const doc = parseDocument(yaml);
		const before = doc.toString();
		const findings = [
			{ type: "unknown_issue", issueNumber: 5, artifactId: "i5_foo", detail: "" },
			{ type: "closed_in_flow", issueNumber: 5, artifactId: "i5_foo", detail: "", fixVia: "flow" },
		];
		applyFixes(doc, findings, new Map());
		assert.equal(doc.toString(), before);
	});
});

// ---------------------------------------------------------------------------
// applyClosedInFlowFixes
// ---------------------------------------------------------------------------

describe("applyClosedInFlowFixes", () => {
	// Case A1: terminal artifact, sole-output process → remove artifact, process, and edge line
	it("A1: terminal sole-output — removes artifact, process, and edge from body", () => {
		const yaml = `artifact:
  cli_tool:
    label: CLI
    status: done
  i16_def_jump:
    label: def-jump feature
    status: todo
process:
  implement_def_jump:
    label: Implement def-jump
`;
		const body = `\ncli_tool >> implement_def_jump -> i16_def_jump\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 16,
				artifactId: "i16_def_jump",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: false,
			},
		];
		const newBody = applyClosedInFlowFixes(doc, body, findings);
		const fm = doc.toJS();
		// artifact removed from frontmatter
		assert.equal(fm.artifact.i16_def_jump, undefined, "artifact should be removed");
		// sole-output process removed from frontmatter
		assert.equal(fm.process?.implement_def_jump, undefined, "sole-output process should be removed");
		// edge line removed from body
		assert.ok(!newBody.includes("implement_def_jump"), "edge should be removed from body");
		assert.ok(!newBody.includes("i16_def_jump"), "artifact should not appear in body");
	});

	// Case A2: terminal artifact, multi-output process → remove artifact from list, keep process and edge
	it("A2: terminal multi-output — removes artifact from list, keeps process and other outputs", () => {
		const yaml = `artifact:
  spec_v006:
    label: Spec v0.0.6
    status: done
  i5_hierarchy_spec:
    label: Hierarchy spec
    status: todo
  multifile_policy:
    label: Policy
    status: todo
process:
  draft_multifile_specs:
    label: Draft multi-file specs
`;
		const body = `\nspec_v006 >> draft_multifile_specs -> [i5_hierarchy_spec, multifile_policy]\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 5,
				artifactId: "i5_hierarchy_spec",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: false,
			},
		];
		const newBody = applyClosedInFlowFixes(doc, body, findings);
		const fm = doc.toJS();
		// closed artifact removed from frontmatter
		assert.equal(fm.artifact.i5_hierarchy_spec, undefined, "closed artifact should be removed");
		// multi-output process kept
		assert.ok(fm.process?.draft_multifile_specs, "multi-output process should be kept");
		// other artifact kept
		assert.ok(fm.artifact.multifile_policy, "other output should remain in frontmatter");
		// body still has the edge but without the closed artifact
		assert.ok(!newBody.includes("i5_hierarchy_spec"), "closed artifact should not appear in body");
		assert.ok(newBody.includes("multifile_policy"), "other output should remain in body");
		assert.ok(newBody.includes("draft_multifile_specs"), "process should remain in body");
	});


		it("B: description containing ' #' survives write→re-parse round-trip without truncation", () => {
			const yaml = `artifact:
  cli_tool:
    label: CLI
    status: done
  i4_lint_checker:
    label: Lint checker
    description: lint 候補の完全リストは issue #4 が一次情報
    status: todo
process:
  use_lint:
    label: Use lint
`;
			const body = `\ncli_tool >> run_lint -> i4_lint_checker\ni4_lint_checker >> use_lint -> cli_tool\n`;
			const doc = parseDocument(yaml);
			const findings = [
				{
					type: "closed_in_flow",
					issueNumber: 4,
					artifactId: "i4_lint_checker",
					detail: "issue is closed",
					fixVia: "flow",
					hasDownstream: true,
				},
			];
			applyClosedInFlowFixes(doc, body, findings);
			// Re-parse the emitted YAML to simulate the next file read
			const emitted = doc.toString();
			const reparsed = parseDocument(emitted).toJS();
			const desc = reparsed.artifact?.lint_checker?.description;
			assert.equal(
				desc,
				"lint 候補の完全リストは issue #4 が一次情報",
				`description was truncated at ' #': got "${desc}"`,
			);
		});

	// Case B: non-terminal, not done → demote: strip iN_ prefix, set status done, update body refs
	it("B: non-terminal not-done — strips prefix, sets done, updates body refs", () => {
		const yaml = `artifact:
  cli_tool:
    label: CLI
    status: done
  i16_def_jump:
    label: def-jump feature
    status: todo
    updated_at: "2026-01-01T00:00:00Z"
    tags:
      - priority:high
process:
  implement_def_jump:
    label: Implement def-jump
  use_def_jump:
    label: Use def-jump
`;
		const body = `\ncli_tool >> implement_def_jump -> i16_def_jump\ni16_def_jump >> use_def_jump -> cli_tool\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 16,
				artifactId: "i16_def_jump",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: true,
			},
		];
		const newBody = applyClosedInFlowFixes(doc, body, findings);
		const fm = doc.toJS();
		// old id gone
		assert.equal(fm.artifact.i16_def_jump, undefined, "old prefixed id should be removed");
		// new id present with status done
		assert.ok(fm.artifact.def_jump, "demoted artifact should exist");
		assert.equal(fm.artifact.def_jump.status, "done");
		// priority drift fields removed
		assert.equal(fm.artifact.def_jump.updated_at, undefined, "updated_at should be removed");
		assert.equal(fm.artifact.def_jump.tags, undefined, "tags should be removed");
		// body refs updated
		assert.ok(!newBody.includes("i16_def_jump"), "old id should not appear in body");
		assert.ok(newBody.includes("def_jump"), "new id should appear in body");
	});
});

// ---------------------------------------------------------------------------
// computeLabelFindings
// ---------------------------------------------------------------------------

describe("computeLabelFindings", () => {
	const expected = [
		{ name: "flow:managed", description: "tracked in .pfdsl/plan.pfdsl" },
		{ name: "flow:exempt", description: "intentionally out of .pfdsl/plan.pfdsl scope" },
	];

	it("returns empty when all labels match", () => {
		const actual = [
			{ name: "flow:managed", description: "tracked in .pfdsl/plan.pfdsl" },
			{ name: "flow:exempt", description: "intentionally out of .pfdsl/plan.pfdsl scope" },
		];
		assert.deepEqual(computeLabelFindings(expected, actual), []);
	});

	it("label_missing when label does not exist", () => {
		const actual = [
			{ name: "flow:managed", description: "tracked in .pfdsl/plan.pfdsl" },
		];
		const findings = computeLabelFindings(expected, actual);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].type, "label_missing");
		assert.equal(findings[0].name, "flow:exempt");
		assert.equal(findings[0].fixVia, "github");
	});

	it("label_description_mismatch when description is wrong", () => {
		const actual = [
			{ name: "flow:managed", description: "old description" },
			{ name: "flow:exempt", description: "intentionally out of .pfdsl/plan.pfdsl scope" },
		];
		const findings = computeLabelFindings(expected, actual);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].type, "label_description_mismatch");
		assert.equal(findings[0].name, "flow:managed");
		assert.equal(findings[0].description, "tracked in .pfdsl/plan.pfdsl");
		assert.equal(findings[0].fixVia, "github");
	});

	it("ignores extra labels not in expected", () => {
		const actual = [
			{ name: "flow:managed", description: "tracked in .pfdsl/plan.pfdsl" },
			{ name: "flow:exempt", description: "intentionally out of .pfdsl/plan.pfdsl scope" },
			{ name: "bug", description: "Something isn't working" },
		];
		assert.deepEqual(computeLabelFindings(expected, actual), []);
	});
});
