import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	parseIssueProcesses,
	buildProcessOutputs,
	computeFindings,
	applyFixes,
	applyClosedInFlowFixes,
	computeLabelFindings,
	normalizeBody,
} from "./issues-flow-audit.mjs";
import { parseDocument } from "./yaml-require.mjs";

// ---------------------------------------------------------------------------
// parseIssueProcesses
// ---------------------------------------------------------------------------

describe("parseIssueProcesses", () => {
	it("returns empty array when no process key", () => {
		const result = parseIssueProcesses({});
		assert.deepEqual(result, []);
	});

	it("ignores non-iN_ processes", () => {
		const fm = {
			process: {
				build_cli: { label: "CLI" },
				write_docs: { label: "Docs" },
			},
		};
		const result = parseIssueProcesses(fm);
		assert.deepEqual(result, []);
	});

	it("parses iN_ processes and extracts issueNumbers", () => {
		const fm = {
			process: {
				i4_build_lint_checker: { label: "Lint", tags: ["priority:high"] },
				i11_port_skill: { label: "Skill", tags: ["priority:high"] },
			},
		};
		const result = parseIssueProcesses(fm);
		assert.equal(result.length, 2);
		assert.equal(result[0].id, "i4_build_lint_checker");
		assert.deepEqual(result[0].issueNumbers, [4]);
		assert.deepEqual(result[0].priorities, ["priority:high"]);
		assert.deepEqual(result[1].issueNumbers, [11]);
	});

	it("updatedAt and priorities default correctly when fields absent; updatedAt extracted when present", () => {
		const absent = parseIssueProcesses({ process: { i5_draft_hierarchy_spec: { label: "H" } } });
		assert.equal(absent[0].updatedAt, undefined);
		assert.deepEqual(absent[0].priorities, []);

		const present = parseIssueProcesses({ process: { i5_draft_hierarchy_spec: { label: "H", updated_at: "2026-06-01T00:00:00Z" } } });
		assert.equal(present[0].updatedAt, "2026-06-01T00:00:00Z");
	});

	it("priorities filters only priority: tags and sorts them", () => {
		const fm = {
			process: {
				i5_draft_hierarchy_spec: {
					label: "H",
					tags: ["foo", "priority:high", "priority:low", "bar"],
				},
			},
		};
		const result = parseIssueProcesses(fm);
		assert.deepEqual(result[0].priorities, ["priority:high", "priority:low"]);
	});

	it("mixes iN_ and non-iN_ processes correctly", () => {
		const fm = {
			process: {
				build_cli: { label: "CLI" },
				i18_sync_issues: { label: "Sync", tags: ["priority:high"] },
				write_docs: { label: "Docs" },
			},
		};
		const result = parseIssueProcesses(fm);
		assert.equal(result.length, 1);
		assert.deepEqual(result[0].issueNumbers, [18]);
	});

	it("parses concatenated iN_ prefixes when one process is tracked by multiple issues", () => {
		const fm = {
			process: {
				i40_i41_do_work: { label: "Do work" },
			},
		};
		const result = parseIssueProcesses(fm);
		assert.equal(result.length, 1);
		assert.equal(result[0].id, "i40_i41_do_work");
		assert.deepEqual(result[0].issueNumbers, [40, 41]);
	});
});

// ---------------------------------------------------------------------------
// buildProcessOutputs
// ---------------------------------------------------------------------------

describe("buildProcessOutputs", () => {
	it("maps process id to single output", () => {
		const body = "a >> P -> b\n";
		const result = buildProcessOutputs(body);
		assert.deepEqual(result.get("P"), ["b"]);
	});

	it("maps process id to multiple outputs from a list edge", () => {
		const body = "a >> P -> [b, c]\n";
		const result = buildProcessOutputs(body);
		assert.deepEqual(result.get("P"), ["b", "c"]);
	});

	it("merges outputs across multiple edge lines for the same process", () => {
		const body = "a >> P -> b\nx >> P -> c\n";
		const result = buildProcessOutputs(body);
		assert.deepEqual(result.get("P"), ["b", "c"]);
	});

	it("returns an empty map for a body with no edges", () => {
		const result = buildProcessOutputs("not an edge line\n");
		assert.equal(result.size, 0);
	});
});

// ---------------------------------------------------------------------------
// computeFindings
// ---------------------------------------------------------------------------

describe("computeFindings", () => {
	it("missing_label: open issue with tracked process but no flow:managed", () => {
		const entries = [{ processId: "i5_draft_hierarchy_spec", issueNumber: 5, artifactId: "hierarchy_spec", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: [], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "missing_label");
		assert.ok(f);
		assert.equal(f.issueNumber, 5);
		assert.equal(f.processId, "i5_draft_hierarchy_spec");
		assert.equal(f.artifactId, "hierarchy_spec");
		assert.equal(f.fixVia, "github");
	});

	it("no missing_label when flow:managed is present", () => {
		const entries = [{ processId: "i5_draft_hierarchy_spec", issueNumber: 5, artifactId: "hierarchy_spec", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		assert.ok(!findings.find((f) => f.type === "missing_label"));
	});

	it("exempt_conflict: open issue with tracked process AND flow:exempt label", () => {
		const entries = [{ processId: "i5_draft_hierarchy_spec", issueNumber: 5, artifactId: "hierarchy_spec", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed", "flow:exempt"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "exempt_conflict");
		assert.ok(f);
		assert.equal(f.fixVia, undefined);
	});

	it("exempt_conflict without managed: no missing_label (bot must not add flow:managed to exempt issues)", () => {
		const entries = [{ processId: "i5_draft_hierarchy_spec", issueNumber: 5, artifactId: "hierarchy_spec", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:exempt"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		assert.ok(findings.find((f) => f.type === "exempt_conflict"), "should still report exempt_conflict");
		assert.ok(!findings.find((f) => f.type === "missing_label"), "must not report missing_label for exempt issues");
	});

	it("missing_process: open issue with flow:managed but no tracked process", () => {
		const issues = [{ number: 99, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings([], issues);
		const f = findings.find((f) => f.type === "missing_process");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(f.processId, undefined);
		assert.equal(f.artifactId, undefined);
		assert.equal(f.fixVia, undefined);
	});

	it("untriaged: open issue with no tracked process and no flow labels", () => {
		const issues = [{ number: 99, state: "OPEN", labels: [], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings([], issues);
		const f = findings.find((f) => f.type === "untriaged");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(f.fixVia, undefined);
	});

	it("no finding: open issue with flow:exempt and no tracked process", () => {
		const issues = [{ number: 99, state: "OPEN", labels: ["flow:exempt"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings([], issues);
		assert.equal(findings.length, 0);
	});

	it("unknown_issue: entry whose issueNumber is not in issues list", () => {
		const entries = [{ processId: "i99_do_foo", issueNumber: 99, artifactId: "foo", status: "todo", updatedAt: undefined, priorities: [] }];
		const findings = computeFindings(entries, []);
		const f = findings.find((f) => f.type === "unknown_issue");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(f.processId, "i99_do_foo");
		assert.equal(f.artifactId, "foo");
		assert.equal(f.fixVia, undefined);
	});

	it("closed_in_flow: entry for closed issue with status !== done", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "CLOSED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "closed_in_flow");
		assert.ok(f);
		assert.equal(f.fixVia, "flow");
		assert.ok(f.detail.includes("delete the chain"), "detail should guide cleanup");
	});

	it("closed_in_flow: entry for closed issue with status done also emits finding", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "done", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "CLOSED", labels: ["flow:managed"], updatedAt: "2026-02-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const matching = findings.filter((f) => f.issueNumber === 5);
		assert.equal(matching.length, 1);
		assert.equal(matching[0].type, "closed_in_flow");
		assert.equal(matching[0].fixVia, "flow");
		assert.ok(matching[0].detail.includes("delete the chain"), "detail should guide cleanup");
	});

	it("closed_not_planned: NOT_PLANNED close without downstream → fixVia:flow (auto-removable)", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [], hasDownstream: false }];
		const issues = [{ number: 5, state: "CLOSED", stateReason: "NOT_PLANNED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "closed_not_planned");
		assert.ok(f, "should emit closed_not_planned");
		assert.ok(!findings.find((f) => f.type === "closed_in_flow"), "must not emit closed_in_flow");
		assert.equal(f.fixVia, "flow");
		assert.equal(f.hasDownstream, false);
	});

	it("closed_not_planned: NOT_PLANNED close with downstream → manual (no fixVia)", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [], hasDownstream: true }];
		const issues = [{ number: 5, state: "CLOSED", stateReason: "NOT_PLANNED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "closed_not_planned");
		assert.ok(f, "should emit closed_not_planned");
		assert.equal(f.fixVia, undefined, "has downstream: must not auto-fix");
	});

	it("closed_in_flow: COMPLETED stateReason still uses closed_in_flow type", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "CLOSED", stateReason: "COMPLETED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "closed_in_flow");
		assert.ok(f, "COMPLETED close should use closed_in_flow");
		assert.ok(!findings.find((f) => f.type === "closed_not_planned"));
	});

	it("stale_updated_at: open issue with mismatched updatedAt", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "stale_updated_at");
		assert.ok(f);
		assert.equal(f.fixVia, "file");
		assert.ok(f.detail.includes("2026-01-01T00:00:00Z"));
		assert.ok(f.detail.includes("2026-06-01T00:00:00Z"));
	});

	it("stale_updated_at: entry missing updatedAt shows (none)", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: undefined, priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "stale_updated_at");
		assert.ok(f);
		assert.ok(f.detail.includes("(none)"));
	});

	it("no stale_updated_at when updatedAt matches", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-06-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		assert.ok(!findings.find((f) => f.type === "stale_updated_at"));
	});

	it("priority_drift: issue priority labels differ from process priorities", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-06-01T00:00:00Z", priorities: ["priority:high"] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed", "priority:low"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "priority_drift");
		assert.ok(f);
		assert.equal(f.fixVia, "file");
	});

	it("no priority_drift when both have no priority labels", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-06-01T00:00:00Z", priorities: [] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		assert.ok(!findings.find((f) => f.type === "priority_drift"));
	});

	it("one pair can yield multiple findings", () => {
		const entries = [{ processId: "i5_do_foo", issueNumber: 5, artifactId: "foo", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: ["priority:high"] }];
		const issues = [{ number: 5, state: "OPEN", labels: ["priority:low"], updatedAt: "2026-06-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		assert.ok(findings.find((f) => f.type === "missing_label"));
		assert.ok(findings.find((f) => f.type === "stale_updated_at"));
		assert.ok(findings.find((f) => f.type === "priority_drift"));
	});

	it("findings are ordered by issueNumber ascending", () => {
		const entries = [
			{ processId: "i10_do_foo", issueNumber: 10, artifactId: "foo", status: "todo", updatedAt: undefined, priorities: [] },
			{ processId: "i3_do_bar", issueNumber: 3, artifactId: "bar", status: "todo", updatedAt: undefined, priorities: [] },
		];
		const issues = [
			{ number: 10, state: "OPEN", labels: [], updatedAt: "2026-06-01T00:00:00Z" },
			{ number: 3, state: "OPEN", labels: [], updatedAt: "2026-06-01T00:00:00Z" },
		];
		const findings = computeFindings(entries, issues);
		const nums = findings.map((f) => f.issueNumber);
		const first10 = nums.indexOf(10);
		const last3 = nums.lastIndexOf(3);
		assert.ok(last3 < first10 || first10 === -1);
	});

	it("multi-output process: independent findings per output artifact (no aggregation)", () => {
		const entries = [
			{ processId: "i7_draft_specs", issueNumber: 7, artifactId: "spec_a", status: "done", updatedAt: "2026-01-01T00:00:00Z", priorities: [], hasDownstream: true },
			{ processId: "i7_draft_specs", issueNumber: 7, artifactId: "spec_b", status: "todo", updatedAt: "2026-01-01T00:00:00Z", priorities: [], hasDownstream: false },
		];
		const issues = [{ number: 7, state: "CLOSED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const matching = findings.filter((f) => f.issueNumber === 7);
		assert.equal(matching.length, 2, "both spec_a and spec_b still carry a residual updatedAt, so both should produce findings");
		assert.deepEqual(matching.map((f) => f.artifactId).sort(), ["spec_a", "spec_b"]);
		assert.ok(matching.every((f) => f.type === "closed_in_flow"));
	});

	it("closed + done + hasDownstream: no finding once issue-tracking fields are fully cleared (demotion already applied)", () => {
		const entries = [{ processId: "i7_draft_specs", issueNumber: 7, artifactId: "spec_a", status: "done", updatedAt: undefined, priorities: [], hasDownstream: true }];
		const issues = [{ number: 7, state: "CLOSED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		assert.equal(findings.filter((f) => f.issueNumber === 7).length, 0, "no residual fields means demotion is already applied — idempotent no-op");
	});

	it("closed + hasDownstream: finding still emitted when only updatedAt is residual (tags/priorities already cleared)", () => {
		const entries = [{ processId: "i7_draft_specs", issueNumber: 7, artifactId: "spec_a", status: "done", updatedAt: "2026-01-01T00:00:00Z", priorities: [], hasDownstream: true }];
		const issues = [{ number: 7, state: "CLOSED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.issueNumber === 7);
		assert.ok(f, "residual updatedAt alone must still trigger closed_in_flow");
		assert.equal(f.type, "closed_in_flow");
	});

	it("closed + hasDownstream: finding still emitted when only priorities/tags are residual (updatedAt already cleared)", () => {
		const entries = [{ processId: "i7_draft_specs", issueNumber: 7, artifactId: "spec_a", status: "done", updatedAt: undefined, priorities: ["priority:high"], hasDownstream: true }];
		const issues = [{ number: 7, state: "CLOSED", labels: ["flow:managed"], updatedAt: "2026-01-01T00:00:00Z" }];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.issueNumber === 7);
		assert.ok(f, "residual priorities/tags alone must still trigger closed_in_flow");
		assert.equal(f.type, "closed_in_flow");
	});
});

// ---------------------------------------------------------------------------
// applyFixes
// ---------------------------------------------------------------------------

describe("applyFixes", () => {
	it("round-trip: preserves double-quoted label and adds updated_at", () => {
		const yaml = `process:
  i5_draft_hierarchy_spec:
    label: "階層PFD仕様案 (#5)"
  i6_draft_presets_spec:
    label: "共有プリセット仕様案 (#6)"
`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "stale_updated_at",
				issueNumber: 6,
				processId: "i6_draft_presets_spec",
				artifactId: "presets_spec",
				detail: "process: (none), issue: 2026-06-01T00:00:00Z",
				fixVia: "file",
			},
		];
		const issuesByNumber = new Map([
			[6, { number: 6, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }],
		]);
		applyFixes(doc, findings, issuesByNumber);
		const out = doc.toString();
		assert.ok(out.includes('"階層PFD仕様案 (#5)"'), "quoted label should be preserved");
		assert.ok(out.includes("updated_at: 2026-06-01T00:00:00Z"), "updated_at should be added");
	});

	it("priority_drift: replaces priority tags, preserves non-priority tags", () => {
		const yaml = `process:
  i5_do_foo:
    label: Foo
    tags:
      - priority:high
      - foo
`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "priority_drift",
				issueNumber: 5,
				processId: "i5_do_foo",
				artifactId: "foo",
				detail: "process: [priority:high], issue: [priority:low]",
				fixVia: "file",
			},
		];
		const issuesByNumber = new Map([
			[5, { number: 5, state: "OPEN", labels: ["flow:managed", "priority:low"], updatedAt: "2026-06-01T00:00:00Z" }],
		]);
		applyFixes(doc, findings, issuesByNumber);
		const obj = doc.toJS();
		assert.deepEqual(obj.process.i5_do_foo.tags, ["foo", "priority:low"]);
	});

	it("priority_drift: removing last tag deletes the key", () => {
		const yaml = `process:
  i5_do_foo:
    label: Foo
    tags:
      - priority:high
`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "priority_drift",
				issueNumber: 5,
				processId: "i5_do_foo",
				artifactId: "foo",
				detail: "process: [priority:high], issue: []",
				fixVia: "file",
			},
		];
		const issuesByNumber = new Map([
			[5, { number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }],
		]);
		applyFixes(doc, findings, issuesByNumber);
		const obj = doc.toJS();
		assert.equal(obj.process.i5_do_foo.tags, undefined);
	});

	it("ignores findings without fixVia: 'file'", () => {
		const yaml = `process:
  i5_do_foo:
    label: Foo
`;
		const doc = parseDocument(yaml);
		const before = doc.toString();
		const findings = [
			{ type: "unknown_issue", issueNumber: 5, processId: "i5_do_foo", artifactId: "foo", detail: "" },
			{ type: "closed_in_flow", issueNumber: 5, processId: "i5_do_foo", artifactId: "foo", detail: "", fixVia: "flow" },
		];
		applyFixes(doc, findings, new Map());
		assert.equal(doc.toString(), before);
	});

	it("no mid-sentence line breaks: long description/criteria on the process survive emit with lineWidth:0", () => {
		const longDesc = "これはとても長い説明文で、句読点のない位置で折り返されてはいけません。文の途中で改行が入ると意味が変わってしまうため、lineWidth:0 で出力することが必要です。";
		const yamlStr = `process:
  i5_do_foo:
    label: Foo
    description: ${longDesc}
`;
		const doc = parseDocument(yamlStr);
		const findings = [
			{
				type: "stale_updated_at",
				issueNumber: 5,
				processId: "i5_do_foo",
				artifactId: "foo",
				detail: "process: (none), issue: 2026-06-01T00:00:00Z",
				fixVia: "file",
			},
		];
		const issuesByNumber = new Map([
			[5, { number: 5, state: "OPEN", labels: ["flow:managed"], updatedAt: "2026-06-01T00:00:00Z" }],
		]);
		applyFixes(doc, findings, issuesByNumber);
		const out = doc.toString({ lineWidth: 0 });
		const lines = out.split("\n");
		const descLine = lines.find((l) => l.includes("description:"));
		assert.ok(descLine && descLine.includes(longDesc), `description should be on one line, got: ${descLine}`);
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
  def_jump:
    label: def-jump feature
    status: todo
process:
  i16_implement_def_jump:
    label: Implement def-jump
`;
		const body = `\ncli_tool >> i16_implement_def_jump -> def_jump\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 16,
				processId: "i16_implement_def_jump",
				artifactId: "def_jump",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: false,
			},
		];
		const issuesByNumber = new Map([[16, { number: 16, state: "CLOSED" }]]);
		const newBody = applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
		const fm = doc.toJS();
		assert.equal(fm.artifact.def_jump, undefined, "artifact should be removed");
		assert.equal(fm.process?.i16_implement_def_jump, undefined, "sole-output process should be removed");
		assert.ok(!newBody.includes("i16_implement_def_jump"), "edge should be removed from body");
		assert.ok(!newBody.includes("def_jump"), "artifact should not appear in body");
	});

	// Case A2: terminal artifact, multi-output process → remove artifact from list, keep process and edge
	it("A2: terminal multi-output — removes artifact from list, keeps process and other outputs", () => {
		const yaml = `artifact:
  spec_v006:
    label: Spec v0.0.6
    status: done
  hierarchy_spec:
    label: Hierarchy spec
    status: todo
  multifile_policy:
    label: Policy
    status: todo
process:
  i5_draft_multifile_specs:
    label: Draft multi-file specs
`;
		const body = `\nspec_v006 >> i5_draft_multifile_specs -> [hierarchy_spec, multifile_policy]\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 5,
				processId: "i5_draft_multifile_specs",
				artifactId: "hierarchy_spec",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: false,
			},
		];
		const issuesByNumber = new Map([[5, { number: 5, state: "CLOSED" }]]);
		const newBody = applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
		const fm = doc.toJS();
		assert.equal(fm.artifact.hierarchy_spec, undefined, "closed artifact should be removed");
		assert.ok(fm.process?.i5_draft_multifile_specs, "multi-output process should be kept");
		assert.ok(fm.artifact.multifile_policy, "other output should remain in frontmatter");
		assert.ok(!newBody.includes("hierarchy_spec"), "closed artifact should not appear in body");
		assert.ok(newBody.includes("multifile_policy"), "other output should remain in body");
		assert.ok(newBody.includes("i5_draft_multifile_specs"), "process should remain in body");
	});

	it("A1 guard: sole-output process shared by 2 issues — sibling still open, does NOT delete", () => {
		const yaml = `artifact:
  cli_tool:
    label: CLI
    status: done
  multifile_specs:
    label: Multi-file specs
    status: todo
process:
  i5_i6_draft_multifile_specs:
    label: Draft multi-file specs
`;
		const body = `\ncli_tool >> i5_i6_draft_multifile_specs -> multifile_specs\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 5,
				processId: "i5_i6_draft_multifile_specs",
				artifactId: "multifile_specs",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: false,
			},
		];
		const issuesByNumber = new Map([
			[5, { number: 5, state: "CLOSED" }],
			[6, { number: 6, state: "OPEN" }],
		]);
		const newBody = applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
		const fm = doc.toJS();
		assert.ok(fm.artifact.multifile_specs, "artifact must NOT be removed while a sibling issue is still open");
		assert.ok(fm.process?.i5_i6_draft_multifile_specs, "process must NOT be removed while a sibling issue is still open");
		assert.equal(newBody, body, "body must be unchanged while a sibling issue is still open");
	});

	it("A1 guard: sole-output process shared by 2 issues — both closed, deletes as normal", () => {
		const yaml = `artifact:
  cli_tool:
    label: CLI
    status: done
  multifile_specs:
    label: Multi-file specs
    status: todo
process:
  i5_i6_draft_multifile_specs:
    label: Draft multi-file specs
`;
		const body = `\ncli_tool >> i5_i6_draft_multifile_specs -> multifile_specs\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 5,
				processId: "i5_i6_draft_multifile_specs",
				artifactId: "multifile_specs",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: false,
			},
		];
		const issuesByNumber = new Map([
			[5, { number: 5, state: "CLOSED" }],
			[6, { number: 6, state: "CLOSED" }],
		]);
		const newBody = applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
		const fm = doc.toJS();
		assert.equal(fm.artifact.multifile_specs, undefined, "artifact should be removed once every tracking issue is closed");
		assert.equal(fm.process?.i5_i6_draft_multifile_specs, undefined, "process should be removed once every tracking issue is closed");
		assert.ok(!newBody.includes("i5_i6_draft_multifile_specs"), "edge should be removed from body");
	});

	it("closed_not_planned terminal: Case A removal (same as closed_in_flow terminal)", () => {
		const yaml = `artifact:
  cli_tool:
    label: CLI
    status: done
  def_jump:
    label: def-jump feature
    status: todo
process:
  i16_implement_def_jump:
    label: Implement def-jump
`;
		const body = `\ncli_tool >> i16_implement_def_jump -> def_jump\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_not_planned",
				issueNumber: 16,
				processId: "i16_implement_def_jump",
				artifactId: "def_jump",
				detail: "issue closed as not planned",
				fixVia: "flow",
				hasDownstream: false,
			},
		];
		const issuesByNumber = new Map([[16, { number: 16, state: "CLOSED" }]]);
		const newBody = applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
		const fm = doc.toJS();
		assert.equal(fm.artifact.def_jump, undefined, "artifact should be removed");
		assert.equal(fm.process?.i16_implement_def_jump, undefined, "sole-output process should be removed");
		assert.ok(!newBody.includes("i16_implement_def_jump"), "edge should be removed from body");
	});

	// Case B: non-terminal — only clears tags/updated_at. No rename, no status forcing.
	it("B: non-terminal — clears tags/updated_at on the process, leaves ids and status untouched", () => {
		const yaml = `artifact:
  cli_tool:
    label: CLI
    status: done
  def_jump:
    label: def-jump feature
    status: todo
process:
  i16_implement_def_jump:
    label: Implement def-jump
    updated_at: "2026-01-01T00:00:00Z"
    tags:
      - priority:high
  use_def_jump:
    label: Use def-jump
`;
		const body = `\ncli_tool >> i16_implement_def_jump -> def_jump\ndef_jump >> use_def_jump -> cli_tool\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 16,
				processId: "i16_implement_def_jump",
				artifactId: "def_jump",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: true,
			},
		];
		const issuesByNumber = new Map([[16, { number: 16, state: "CLOSED" }]]);
		const newBody = applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
		const fm = doc.toJS();
		// process id unchanged (permanent prefix)
		assert.ok(fm.process.i16_implement_def_jump, "process id must not be renamed");
		// issue-tracking fields cleared
		assert.equal(fm.process.i16_implement_def_jump.updated_at, undefined, "updated_at should be removed");
		assert.equal(fm.process.i16_implement_def_jump.tags, undefined, "tags should be removed");
		// artifact untouched: id unchanged, status NOT forced
		assert.ok(fm.artifact.def_jump, "artifact id must not be renamed");
		assert.equal(fm.artifact.def_jump.status, "todo", "status must not be force-set — it's already correct from the completion commit");
		// body unchanged (no id renamed anywhere)
		assert.equal(newBody.trim(), body.trim());
	});

	it("B: description containing ' #' is untouched (no node-reuse rewrite needed since ids don't change)", () => {
		const yaml = `artifact:
  cli_tool:
    label: CLI
    status: done
  lint_checker:
    label: Lint checker
    description: "lint 候補の完全リストは issue #4 が一次情報"
    status: todo
process:
  i4_run_lint:
    label: Run lint
  use_lint:
    label: Use lint
`;
		const body = `\ncli_tool >> i4_run_lint -> lint_checker\nlint_checker >> use_lint -> cli_tool\n`;
		const doc = parseDocument(yaml);
		const findings = [
			{
				type: "closed_in_flow",
				issueNumber: 4,
				processId: "i4_run_lint",
				artifactId: "lint_checker",
				detail: "issue is closed",
				fixVia: "flow",
				hasDownstream: true,
			},
		];
		const issuesByNumber = new Map([[4, { number: 4, state: "CLOSED" }]]);
		applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
		const emitted = doc.toString();
		const reparsed = parseDocument(emitted).toJS();
		const desc = reparsed.artifact?.lint_checker?.description;
		assert.equal(desc, "lint 候補の完全リストは issue #4 が一次情報");
	});
});

// ---------------------------------------------------------------------------
// normalizeBody
// ---------------------------------------------------------------------------

describe("normalizeBody", () => {
	it("collapses 3+ consecutive newlines to 2", () => {
		const body = "a >> P -> b\n\n\nc >> Q -> d\n";
		assert.equal(normalizeBody(body), "a >> P -> b\n\nc >> Q -> d\n");
	});

	it("collapses 4+ newlines", () => {
		const body = "a >> P -> b\n\n\n\n\nc >> Q -> d\n";
		assert.equal(normalizeBody(body), "a >> P -> b\n\nc >> Q -> d\n");
	});

	it("normalizes multiple trailing blank lines to single newline", () => {
		const body = "a >> P -> b\n\n\n\n";
		assert.equal(normalizeBody(body), "a >> P -> b\n");
	});

	it("leaves already-normalized body unchanged", () => {
		const body = "a >> P -> b\n\nc >> Q -> d\n";
		assert.equal(normalizeBody(body), body);
	});

	it("handles empty body", () => {
		assert.equal(normalizeBody(""), "\n");
	});
});

// ---------------------------------------------------------------------------
// computeLabelFindings
// ---------------------------------------------------------------------------

describe("computeLabelFindings", () => {
	const expected = [
		{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
		{ name: "flow:exempt", description: "intentionally out of .pfdsl/roadmap.pfdsl scope" },
	];

	it("returns empty when all labels match", () => {
		const actual = [
			{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
			{ name: "flow:exempt", description: "intentionally out of .pfdsl/roadmap.pfdsl scope" },
		];
		assert.deepEqual(computeLabelFindings(expected, actual), []);
	});

	it("label_missing when label does not exist", () => {
		const actual = [
			{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
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
			{ name: "flow:exempt", description: "intentionally out of .pfdsl/roadmap.pfdsl scope" },
		];
		const findings = computeLabelFindings(expected, actual);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].type, "label_description_mismatch");
		assert.equal(findings[0].name, "flow:managed");
		assert.equal(findings[0].description, "tracked in .pfdsl/roadmap.pfdsl");
		assert.equal(findings[0].fixVia, "github");
	});

	it("ignores extra labels not in expected", () => {
		const actual = [
			{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
			{ name: "flow:exempt", description: "intentionally out of .pfdsl/roadmap.pfdsl scope" },
			{ name: "bug", description: "Something isn't working" },
		];
		assert.deepEqual(computeLabelFindings(expected, actual), []);
	});
});
