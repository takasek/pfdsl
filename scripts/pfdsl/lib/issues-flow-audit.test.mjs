import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	buildProcessOutputs,
	computeFindings,
	computeLabelFindings,
	parseIssueProcesses,
	partitionFindings,
} from "./issues-flow-audit.mjs";

describe("closed issue audit removal", () => {
	for (const stateReason of ["COMPLETED", "NOT_PLANNED"]) {
		for (const [hasDownstream, updatedAt, priorities] of [
			[false, "2026-01-01T00:00:00Z", ["priority:high"]],
			[true, "2026-01-01T00:00:00Z", ["priority:high"]],
			[true, undefined, []],
		]) {
			it(`does not report closed ${stateReason} entries with tracking variation ${String(hasDownstream)}:${updatedAt ?? "none"}`, () => {
				const findings = computeFindings(
					[
						{
							processId: "i959_do_foo",
							issueNumber: 959,
							artifactId: "foo",
							hasDownstream,
							updatedAt,
							priorities,
						},
					],
					[
						{
							number: 959,
							state: "CLOSED",
							stateReason,
							labels: ["flow:managed"],
							updatedAt: "2026-02-01T00:00:00Z",
						},
					],
				);
				assert.deepEqual(findings, []);
				assert.deepEqual(
					partitionFindings(findings, { enforcedIssues: [959] }),
					{ blocking: [], advisory: [] },
				);
			});
		}
	}
});

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
		const absent = parseIssueProcesses({
			process: { i5_draft_hierarchy_spec: { label: "H" } },
		});
		assert.equal(absent[0].updatedAt, undefined);
		assert.deepEqual(absent[0].priorities, []);

		const present = parseIssueProcesses({
			process: {
				i5_draft_hierarchy_spec: {
					label: "H",
					updated_at: "2026-06-01T00:00:00Z",
				},
			},
		});
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
		const entries = [
			{
				processId: "i5_draft_hierarchy_spec",
				issueNumber: 5,
				artifactId: "hierarchy_spec",
				updatedAt: "2026-01-01T00:00:00Z",
				priorities: [],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: [],
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "missing_label");
		assert.ok(f);
		assert.equal(f.issueNumber, 5);
		assert.equal(f.processId, "i5_draft_hierarchy_spec");
		assert.equal(f.artifactId, "hierarchy_spec");
	});

	it("no missing_label when flow:managed is present", () => {
		const entries = [
			{
				processId: "i5_draft_hierarchy_spec",
				issueNumber: 5,
				artifactId: "hierarchy_spec",
				updatedAt: "2026-01-01T00:00:00Z",
				priorities: [],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["flow:managed"],
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		assert.ok(!findings.find((f) => f.type === "missing_label"));
	});

	it("exempt_conflict: open issue with tracked process AND flow:exempt label", () => {
		const entries = [
			{
				processId: "i5_draft_hierarchy_spec",
				issueNumber: 5,
				artifactId: "hierarchy_spec",
				updatedAt: "2026-01-01T00:00:00Z",
				priorities: [],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["flow:managed", "flow:exempt"],
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "exempt_conflict");
		assert.ok(f);
	});

	it("exempt_conflict without managed: no missing_label (bot must not add flow:managed to exempt issues)", () => {
		const entries = [
			{
				processId: "i5_draft_hierarchy_spec",
				issueNumber: 5,
				artifactId: "hierarchy_spec",
				updatedAt: "2026-01-01T00:00:00Z",
				priorities: [],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["flow:exempt"],
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		assert.ok(
			findings.find((f) => f.type === "exempt_conflict"),
			"should still report exempt_conflict",
		);
		assert.ok(
			!findings.find((f) => f.type === "missing_label"),
			"must not report missing_label for exempt issues",
		);
	});

	it("missing_process: open issue with flow:managed but no tracked process", () => {
		const issues = [
			{
				number: 99,
				state: "OPEN",
				labels: ["flow:managed"],
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		const findings = computeFindings([], issues);
		const f = findings.find((f) => f.type === "missing_process");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(f.processId, undefined);
		assert.equal(f.artifactId, undefined);
		assert.equal(
			f.advisory,
			true,
			"missing_process must not block: the roadmap entry for a managed issue is routinely still on an unmerged branch",
		);
	});

	it("untriaged: open issue with no tracked process and no flow labels", () => {
		const issues = [
			{
				number: 99,
				state: "OPEN",
				labels: [],
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		const findings = computeFindings([], issues);
		const f = findings.find((f) => f.type === "untriaged");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(
			f.advisory,
			true,
			"untriaged must not block unrelated branches: the target cycle enforces its own issue separately",
		);
	});

	it("no finding: open issue with flow:exempt and no tracked process", () => {
		const issues = [
			{
				number: 99,
				state: "OPEN",
				labels: ["flow:exempt"],
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		const findings = computeFindings([], issues);
		assert.equal(findings.length, 0);
	});

	it("unknown_issue: entry whose issueNumber is not in issues list", () => {
		const entries = [
			{
				processId: "i99_do_foo",
				issueNumber: 99,
				artifactId: "foo",
				updatedAt: undefined,
				priorities: [],
			},
		];
		const findings = computeFindings(entries, []);
		const f = findings.find((f) => f.type === "unknown_issue");
		assert.ok(f);
		assert.equal(f.issueNumber, 99);
		assert.equal(f.processId, "i99_do_foo");
		assert.equal(f.artifactId, "foo");
	});

	it("stale_updated_at: open issue with mismatched updatedAt", () => {
		const entries = [
			{
				processId: "i5_do_foo",
				issueNumber: 5,
				artifactId: "foo",
				updatedAt: "2026-01-01T00:00:00Z",
				priorities: [],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["flow:managed"],
				updatedAt: "2026-06-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "stale_updated_at");
		assert.ok(f);
		assert.ok(f.detail.includes("2026-01-01T00:00:00Z"));
		assert.ok(f.detail.includes("2026-06-01T00:00:00Z"));
	});

	it("stale_updated_at: entry missing updatedAt shows (none)", () => {
		const entries = [
			{
				processId: "i5_do_foo",
				issueNumber: 5,
				artifactId: "foo",
				updatedAt: undefined,
				priorities: [],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["flow:managed"],
				updatedAt: "2026-06-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "stale_updated_at");
		assert.ok(f);
		assert.ok(f.detail.includes("(none)"));
	});

	it("no stale_updated_at when updatedAt matches", () => {
		const entries = [
			{
				processId: "i5_do_foo",
				issueNumber: 5,
				artifactId: "foo",
				updatedAt: "2026-06-01T00:00:00Z",
				priorities: [],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["flow:managed"],
				updatedAt: "2026-06-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		assert.ok(!findings.find((f) => f.type === "stale_updated_at"));
	});

	it("priority_drift: issue priority labels differ from process priorities", () => {
		const entries = [
			{
				processId: "i5_do_foo",
				issueNumber: 5,
				artifactId: "foo",
				updatedAt: "2026-06-01T00:00:00Z",
				priorities: ["priority:high"],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["flow:managed", "priority:low"],
				updatedAt: "2026-06-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		const f = findings.find((f) => f.type === "priority_drift");
		assert.ok(f);
	});

	it("no priority_drift when both have no priority labels", () => {
		const entries = [
			{
				processId: "i5_do_foo",
				issueNumber: 5,
				artifactId: "foo",
				updatedAt: "2026-06-01T00:00:00Z",
				priorities: [],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["flow:managed"],
				updatedAt: "2026-06-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		assert.ok(!findings.find((f) => f.type === "priority_drift"));
	});

	it("one pair can yield multiple findings", () => {
		const entries = [
			{
				processId: "i5_do_foo",
				issueNumber: 5,
				artifactId: "foo",
				updatedAt: "2026-01-01T00:00:00Z",
				priorities: ["priority:high"],
			},
		];
		const issues = [
			{
				number: 5,
				state: "OPEN",
				labels: ["priority:low"],
				updatedAt: "2026-06-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		assert.ok(findings.find((f) => f.type === "missing_label"));
		assert.ok(findings.find((f) => f.type === "stale_updated_at"));
		assert.ok(findings.find((f) => f.type === "priority_drift"));
	});

	it("findings are ordered by issueNumber ascending", () => {
		const entries = [
			{
				processId: "i10_do_foo",
				issueNumber: 10,
				artifactId: "foo",
				updatedAt: undefined,
				priorities: [],
			},
			{
				processId: "i3_do_bar",
				issueNumber: 3,
				artifactId: "bar",
				updatedAt: undefined,
				priorities: [],
			},
		];
		const issues = [
			{
				number: 10,
				state: "OPEN",
				labels: [],
				updatedAt: "2026-06-01T00:00:00Z",
			},
			{
				number: 3,
				state: "OPEN",
				labels: [],
				updatedAt: "2026-06-01T00:00:00Z",
			},
		];
		const findings = computeFindings(entries, issues);
		const nums = findings.map((f) => f.issueNumber);
		const first10 = nums.indexOf(10);
		const last3 = nums.lastIndexOf(3);
		assert.ok(last3 < first10 || first10 === -1);
	});
});

// ---------------------------------------------------------------------------
// computeLabelFindings
// ---------------------------------------------------------------------------

describe("computeLabelFindings", () => {
	const expected = [
		{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
		{
			name: "flow:exempt",
			description: "intentionally out of .pfdsl/roadmap.pfdsl scope",
		},
	];

	it("returns empty when all labels match", () => {
		const actual = [
			{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
			{
				name: "flow:exempt",
				description: "intentionally out of .pfdsl/roadmap.pfdsl scope",
			},
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
	});

	it("label_description_mismatch when description is wrong", () => {
		const actual = [
			{ name: "flow:managed", description: "old description" },
			{
				name: "flow:exempt",
				description: "intentionally out of .pfdsl/roadmap.pfdsl scope",
			},
		];
		const findings = computeLabelFindings(expected, actual);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].type, "label_description_mismatch");
		assert.equal(findings[0].name, "flow:managed");
		assert.equal(findings[0].description, "tracked in .pfdsl/roadmap.pfdsl");
	});

	it("ignores extra labels not in expected", () => {
		const actual = [
			{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
			{
				name: "flow:exempt",
				description: "intentionally out of .pfdsl/roadmap.pfdsl scope",
			},
			{ name: "bug", description: "Something isn't working" },
		];
		assert.deepEqual(computeLabelFindings(expected, actual), []);
	});
});

// ---------------------------------------------------------------------------
// partitionFindings
// ---------------------------------------------------------------------------

describe("partitionFindings", () => {
	const blocking = { type: "stale_updated_at", issueNumber: 1 };
	const advisory = { type: "missing_process", issueNumber: 3, advisory: true };

	it("splits findings into blocking and advisory", () => {
		const parts = partitionFindings([blocking, advisory]);
		assert.deepEqual(parts.blocking, [blocking]);
		assert.deepEqual(parts.advisory, [advisory]);
	});

	it("keeps advisory findings out of blocking, so they cannot fail the audit", () => {
		const parts = partitionFindings([advisory]);
		assert.deepEqual(parts.blocking, []);
		assert.equal(parts.advisory.length, 1);
	});

	it("promotes an advisory finding to blocking when its issue is enforced", () => {
		const parts = partitionFindings([advisory], { enforcedIssues: [3] });
		assert.deepEqual(parts.blocking, [advisory]);
		assert.deepEqual(parts.advisory, []);
	});

	it("leaves advisory findings for issues outside the enforced set alone", () => {
		const parts = partitionFindings([advisory], { enforcedIssues: [999] });
		assert.deepEqual(parts.blocking, []);
		assert.deepEqual(parts.advisory, [advisory]);
	});

	it("enforces only the target issue while unrelated untriaged issues stay advisory", () => {
		const target = { type: "untriaged", issueNumber: 3, advisory: true };
		const unrelated = { type: "untriaged", issueNumber: 4, advisory: true };
		const parts = partitionFindings([target, unrelated], {
			enforcedIssues: [3],
		});
		assert.deepEqual(parts.blocking, [target]);
		assert.deepEqual(parts.advisory, [unrelated]);
	});
});
