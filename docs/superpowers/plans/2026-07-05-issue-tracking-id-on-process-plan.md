# Issue-tracking id on Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `iN_` issue-tracking-id convention from Artifact to Process (permanently — never stripped on issue close), per `docs/superpowers/specs/2026-07-04-issue-tracking-id-on-process-design.md`.

**Architecture:** `scripts/lib/issues-flow-audit.mjs` (pure logic, zero I/O) gets its artifact-keyed functions replaced with process-keyed ones; `scripts/audit-issues-flow.mjs` (the `gh`-calling orchestrator) is rewired to expand each tracked process into one entry per `(issueNumber, output artifact)` pair before calling into the pure lib — same split as today, just re-keyed. Four docs (`github-issues-backend.md`, `architecture.md`, the workflow yaml + its install mirror) get their wording corrected. Finally the 10 currently-open `iN_`-prefixed chains in `.pfdsl/roadmap.pfdsl` are migrated via a one-off scratch script.

**Tech Stack:** Node.js (`node:test`/`node:assert/strict`), the `yaml` package (via `scripts/lib/yaml-require.mjs`), `gh` CLI (orchestrator only, not unit-tested).

## Global Constraints

- This work is `flow:exempt` (design doc §"スコープ判定") — no GH issue filed, no `.pfdsl/roadmap.pfdsl` chain added for the redesign work itself.
- `install/` and its deployed mirror must stay byte-identical (`check-pfd-ops-sync.yml`, ADR-0016) — any edit to `.github/workflows/flow-on-issue-close.yml` must be mirrored in `.claude/skills/pfd-ops/install/.github/workflows/flow-on-issue-close.yml` in the same commit.
- Commit messages: English, Conventional Commits, one logical change per commit.
- `.pfdsl`/`.md` prose: line-break only at sentence boundaries (句読点), never mid-word/mid-phrase.
- Work happens on branch `chore/process-tracking-id-design` (already cut from `origin/main`, currently holds the design-doc commits only).

---

### Task 1: `parseIssueProcesses` replaces `parseIssueArtifacts`

**Files:**
- Modify: `scripts/lib/issues-flow-audit.mjs:40-62` (the `parseIssueArtifacts` function + its JSDoc)
- Test: `scripts/lib/issues-flow-audit.test.mjs:14-87` (the `parseIssueArtifacts` describe block)

**Interfaces:**
- Consumes: nothing new (reads `frontmatter.process` instead of `frontmatter.artifact`)
- Produces: `parseIssueProcesses(frontmatter) -> { id: string, issueNumbers: number[], updatedAt: string|undefined, priorities: string[] }[]` — used by Task 6 (orchestrator)

- [ ] **Step 1: Replace the test block with process-keyed cases**

Replace lines 1-16 (imports) and lines 14-87 (the whole `parseIssueArtifacts` describe block) in `scripts/lib/issues-flow-audit.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	parseIssueProcesses,
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
```

- [ ] **Step 2: Run the test file to verify the new cases fail**

Run: `node --test scripts/lib/issues-flow-audit.test.mjs`
Expected: FAIL — `parseIssueProcesses is not a function` (import error), since `issues-flow-audit.mjs` doesn't export it yet.

- [ ] **Step 3: Replace `parseIssueArtifacts` with `parseIssueProcesses` in the lib**

Replace lines 40-62 of `scripts/lib/issues-flow-audit.mjs`:

```js
/**
 * @param {object} frontmatter - parsed YAML object
 * @returns {{ id: string, issueNumbers: number[], updatedAt: string|undefined, priorities: string[] }[]}
 */
export function parseIssueProcesses(frontmatter) {
	const process = frontmatter.process;
	if (!process) return [];
	const result = [];
	for (const [id, val] of Object.entries(process)) {
		const prefixMatch = id.match(/^(?:i\d+_)+/);
		if (!prefixMatch) continue;
		const issueNumbers = [...prefixMatch[0].matchAll(/i(\d+)_/g)].map((m) => Number(m[1]));
		const tags = val.tags ?? [];
		const priorities = tags.filter((t) => t.startsWith("priority:")).sort();
		result.push({ id, issueNumbers, updatedAt: val.updated_at, priorities });
	}
	return result;
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `node --test scripts/lib/issues-flow-audit.test.mjs`
Expected: PASS for the `parseIssueProcesses` describe block. (Other blocks will still fail/error at this point — expected, they're rewritten in later tasks. If your test runner aborts on the first failing describe, run with `--test-name-pattern='parseIssueProcesses'` to isolate.)

Run: `node --test --test-name-pattern='parseIssueProcesses' scripts/lib/issues-flow-audit.test.mjs`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/issues-flow-audit.mjs scripts/lib/issues-flow-audit.test.mjs
git commit -m "refactor(scripts): parse issue-tracking ids from process instead of artifact"
```

---

### Task 2: `buildProcessOutputs` — resolve a process's output artifacts from the flow body

**Files:**
- Modify: `scripts/lib/issues-flow-audit.mjs` (insert new exported function; `parseEdgeLine` at lines 240-250 stays private and is reused internally)
- Test: `scripts/lib/issues-flow-audit.test.mjs` (new describe block, insert after `parseIssueProcesses`)

**Interfaces:**
- Consumes: the private `parseEdgeLine(line)` already in the file (lines 240-250), unchanged
- Produces: `buildProcessOutputs(body) -> Map<string processId, string[] artifactIds>` — used by Task 6 (orchestrator)

- [ ] **Step 1: Write the failing test**

Insert after the `parseIssueProcesses` describe block in `scripts/lib/issues-flow-audit.test.mjs`:

```js
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
```

Also add `buildProcessOutputs` to the import list at the top of the test file (alongside `parseIssueProcesses`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='buildProcessOutputs' scripts/lib/issues-flow-audit.test.mjs`
Expected: FAIL — `buildProcessOutputs is not a function`.

- [ ] **Step 3: Implement `buildProcessOutputs`**

Insert into `scripts/lib/issues-flow-audit.mjs`, right before the `parseEdgeLine` function (currently at line 240):

```js
/**
 * Maps each process id appearing in a flow edge to the list of artifact ids
 * it produces (RHS of `>>`), merged across all edge lines mentioning it.
 * @param {string} body
 * @returns {Map<string, string[]>}
 */
export function buildProcessOutputs(body) {
	const result = new Map();
	for (const line of body.split("\n")) {
		const parsed = parseEdgeLine(line);
		if (!parsed) continue;
		const existing = result.get(parsed.process) ?? [];
		result.set(parsed.process, [...existing, ...parsed.outputs]);
	}
	return result;
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='buildProcessOutputs' scripts/lib/issues-flow-audit.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/issues-flow-audit.mjs scripts/lib/issues-flow-audit.test.mjs
git commit -m "feat(scripts): map process ids to their output artifacts via flow edges"
```

---

### Task 3: Rewrite `computeFindings` to key findings by process (rename `missing_artifact` → `missing_process`)

**Files:**
- Modify: `scripts/lib/issues-flow-audit.mjs:64-192` (the whole `computeFindings` function + its JSDoc)
- Test: `scripts/lib/issues-flow-audit.test.mjs` (the `computeFindings` describe block)

**Interfaces:**
- Consumes: `entries: { processId: string, issueNumber: number, artifactId: string, status: string|undefined, hasDownstream: boolean, updatedAt: string|undefined, priorities: string[] }[]` (constructed by the orchestrator in Task 6 — NOT `parseIssueProcesses`'s raw output; the orchestrator expands each process × issueNumber × output into one entry)
- Produces: findings now carry both `processId` and `artifactId`: `{ type: string, issueNumber: number, processId: string|undefined, artifactId: string|undefined, detail: string, fixVia?: "file"|"github"|"flow", hasDownstream?: boolean }[]` — consumed by Task 4 (`applyFixes`) and Task 5 (`applyClosedInFlowFixes`)

- [ ] **Step 1: Replace the test block with process-keyed cases**

Replace the `computeFindings` describe block (lines 89-284 of the current `scripts/lib/issues-flow-audit.test.mjs`) with:

```js
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
		assert.equal(matching.length, 1, "spec_a (done+hasDownstream) should not produce a finding");
		assert.equal(matching[0].artifactId, "spec_b");
		assert.equal(matching[0].type, "closed_in_flow");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='computeFindings' scripts/lib/issues-flow-audit.test.mjs`
Expected: FAIL — assertions on `f.processId` fail (current `computeFindings` doesn't produce that field), and `missing_process` finding type doesn't exist yet.

- [ ] **Step 3: Rewrite `computeFindings`**

Replace lines 64-192 of `scripts/lib/issues-flow-audit.mjs`:

```js
/**
 * @param {{ processId: string, issueNumber: number, artifactId: string, status: string|undefined, hasDownstream: boolean, updatedAt: string|undefined, priorities: string[] }[]} entries - priorities must be pre-sorted
 * @param {{ number: number, state: "OPEN"|"CLOSED", stateReason?: string|null, labels: string[], updatedAt: string }[]} issues
 * @returns {{ type: string, issueNumber: number, processId: string|undefined, artifactId: string|undefined, detail: string, fixVia?: "file"|"github"|"flow", hasDownstream?: boolean }[]}
 */
export function computeFindings(entries, issues) {
	const trackedIssueNumbers = new Set(entries.map((e) => e.issueNumber));
	const issuesByNumber = new Map();
	for (const iss of issues) {
		issuesByNumber.set(iss.number, iss);
	}

	const findings = [];

	// Check each tracked entry against its issue
	for (const entry of entries) {
		const iss = issuesByNumber.get(entry.issueNumber);
		if (!iss) {
			findings.push({
				type: "unknown_issue",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `issue #${entry.issueNumber} not found in issues list`,
			});
			continue;
		}

		if (iss.state === "CLOSED") {
			// closed + done + has downstream = expected state, no action needed
			if (entry.status === "done" && entry.hasDownstream) {
				continue;
			}
			const isNotPlanned = iss.stateReason === "NOT_PLANNED";
			findings.push({
				type: isNotPlanned ? "closed_not_planned" : "closed_in_flow",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				hasDownstream: entry.hasDownstream,
				detail: isNotPlanned
					? entry.hasDownstream
						? `issue closed as not planned but has downstream consumers — remove manually`
						: `issue closed as not planned — terminal chain will be removed`
					: `issue is closed — delete the chain if terminal, or clear iN_ issue-tracking fields on the process if downstream processes consume the output`,
				fixVia: isNotPlanned && entry.hasDownstream ? undefined : "flow",
			});
			// skip all freshness checks for closed issues
			continue;
		}

		// OPEN issue with a tracked process
		const hasManaged = iss.labels.includes("flow:managed");
		const hasExempt = iss.labels.includes("flow:exempt");

		if (hasExempt) {
			findings.push({
				type: "exempt_conflict",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `issue has flow:exempt label but has a tracked process in the flow`,
			});
		} else if (!hasManaged) {
			findings.push({
				type: "missing_label",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `open issue with tracked process is missing "flow:managed" label`,
				fixVia: "github",
			});
		}

		// Freshness checks for open issues
		if (entry.updatedAt !== iss.updatedAt) {
			const val = entry.updatedAt ?? "(none)";
			findings.push({
				type: "stale_updated_at",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `process: ${val}, issue: ${iss.updatedAt}`,
				fixVia: "file",
			});
		}

		// Priority drift
		const issuePriorities = iss.labels.filter((l) => l.startsWith("priority:")).sort();
		if (JSON.stringify(issuePriorities) !== JSON.stringify(entry.priorities)) {
			findings.push({
				type: "priority_drift",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `process: [${entry.priorities.join(", ")}], issue: [${issuePriorities.join(", ")}]`,
				fixVia: "file",
			});
		}
	}

	// Check each issue for a missing tracked process
	for (const iss of issues) {
		if (iss.state !== "OPEN") continue;
		if (trackedIssueNumbers.has(iss.number)) continue;

		const hasManaged = iss.labels.includes("flow:managed");
		const hasExempt = iss.labels.includes("flow:exempt");

		if (hasExempt) {
			// flow:exempt and no tracked process: no finding
			continue;
		}
		if (hasManaged) {
			findings.push({
				type: "missing_process",
				issueNumber: iss.number,
				processId: undefined,
				artifactId: undefined,
				detail: `issue has flow:managed label but no tracked process in the flow`,
			});
		} else {
			findings.push({
				type: "untriaged",
				issueNumber: iss.number,
				processId: undefined,
				artifactId: undefined,
				detail: `open issue has no tracked process and no flow label`,
			});
		}
	}

	// Stable sort by issueNumber ascending
	findings.sort((a, b) => a.issueNumber - b.issueNumber);

	return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='computeFindings' scripts/lib/issues-flow-audit.test.mjs`
Expected: PASS, 21/21.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/issues-flow-audit.mjs scripts/lib/issues-flow-audit.test.mjs
git commit -m "refactor(scripts): key issue-flow findings by process instead of artifact"
```

---

### Task 4: Retarget `applyFixes` to write process fields

**Files:**
- Modify: `scripts/lib/issues-flow-audit.mjs:194-228` (the `applyFixes` function + its JSDoc)
- Test: `scripts/lib/issues-flow-audit.test.mjs` (the `applyFixes` describe block)

**Interfaces:**
- Consumes: findings from Task 3 (now carry `processId`)
- Produces: same signature `applyFixes(doc, findings, issuesByNumber)`, but writes to `doc["process"][processId]` instead of `doc["artifact"][artifactId]` — used unchanged by the orchestrator (Task 6)

- [ ] **Step 1: Replace the test block**

Replace the `applyFixes` describe block in `scripts/lib/issues-flow-audit.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='applyFixes' scripts/lib/issues-flow-audit.test.mjs`
Expected: FAIL — `doc.process.i5_do_foo` is undefined because `applyFixes` still writes to `["artifact", artifactId, ...]`.

- [ ] **Step 3: Retarget `applyFixes` to `["process", processId, ...]`**

Replace lines 194-228 of `scripts/lib/issues-flow-audit.mjs`:

```js
/**
 * Applies file-fixable findings to the yaml Document in place.
 * @param {import("yaml").Document} doc
 * @param {{ type: string, issueNumber: number, processId: string|undefined, fixVia?: "file"|"github"|"flow" }[]} findings
 * @param {Map<number, { number: number, state: string, labels: string[], updatedAt: string }>} issuesByNumber
 */
export function applyFixes(doc, findings, issuesByNumber) {
	for (const finding of findings) {
		if (finding.fixVia !== "file") continue;
		const { type, processId, issueNumber } = finding;
		const issue = issuesByNumber.get(issueNumber);
		if (!issue) continue;

		if (type === "stale_updated_at") {
			doc.setIn(["process", processId, "updated_at"], issue.updatedAt);
		} else if (type === "priority_drift") {
			// Get existing tags preserving order, remove priority: ones
			const existingTags = doc.getIn(["process", processId, "tags"]);
			let nonPriorityTags = [];
			if (existingTags) {
				// existingTags may be a yaml Seq node or plain array
				const arr = existingTags.toJSON ? existingTags.toJSON() : existingTags;
				nonPriorityTags = arr.filter((t) => !t.startsWith("priority:"));
			}
			const issuePriorities = issue.labels.filter((l) => l.startsWith("priority:")).sort();
			const newTags = [...nonPriorityTags, ...issuePriorities];
			if (newTags.length === 0) {
				doc.deleteIn(["process", processId, "tags"]);
			} else {
				doc.setIn(["process", processId, "tags"], newTags);
			}
		}
		// other types: ignore
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='applyFixes' scripts/lib/issues-flow-audit.test.mjs`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/issues-flow-audit.mjs scripts/lib/issues-flow-audit.test.mjs
git commit -m "refactor(scripts): apply issue-tracking field fixes to process instead of artifact"
```

---

### Task 5: Simplify `applyClosedInFlowFixes` — Case B no longer renames or forces status

**Files:**
- Modify: `scripts/lib/issues-flow-audit.mjs:277-357` (the `applyClosedInFlowFixes` function)
- Test: `scripts/lib/issues-flow-audit.test.mjs` (the `applyClosedInFlowFixes` describe block)

**Interfaces:**
- Consumes: findings from Task 3 (`processId`, `artifactId`, `hasDownstream`)
- Produces: same signature `applyClosedInFlowFixes(doc, body, findings) -> string` — used unchanged by the orchestrator (Task 6)

- [ ] **Step 1: Replace the test block**

Replace the `applyClosedInFlowFixes` describe block in `scripts/lib/issues-flow-audit.test.mjs` (Case A tests are re-keyed but structurally unchanged; Case B tests drop all rename/status-forcing assertions — they now only check that `tags`/`updated_at` are cleared and that the process id is untouched):

```js
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
		const newBody = applyClosedInFlowFixes(doc, body, findings);
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
		const newBody = applyClosedInFlowFixes(doc, body, findings);
		const fm = doc.toJS();
		assert.equal(fm.artifact.hierarchy_spec, undefined, "closed artifact should be removed");
		assert.ok(fm.process?.i5_draft_multifile_specs, "multi-output process should be kept");
		assert.ok(fm.artifact.multifile_policy, "other output should remain in frontmatter");
		assert.ok(!newBody.includes("hierarchy_spec"), "closed artifact should not appear in body");
		assert.ok(newBody.includes("multifile_policy"), "other output should remain in body");
		assert.ok(newBody.includes("i5_draft_multifile_specs"), "process should remain in body");
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
		const newBody = applyClosedInFlowFixes(doc, body, findings);
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
		const newBody = applyClosedInFlowFixes(doc, body, findings);
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
    description: lint 候補の完全リストは issue #4 が一次情報
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
		applyClosedInFlowFixes(doc, body, findings);
		const emitted = doc.toString();
		const reparsed = parseDocument(emitted).toJS();
		const desc = reparsed.artifact?.lint_checker?.description;
		assert.equal(desc, "lint 候補の完全リストは issue #4 が一次情報");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='applyClosedInFlowFixes' scripts/lib/issues-flow-audit.test.mjs`
Expected: FAIL — Case A lookups use `parsed.process === processId` which the current code doesn't check (it only checks `outputs.includes(artifactId)`, harmless collateral pass for A but not required), and Case B assertions fail hard because the current code renames the artifact and forces `status: done`.

- [ ] **Step 3: Rewrite `applyClosedInFlowFixes`**

Replace lines 277-357 of `scripts/lib/issues-flow-audit.mjs` (keep `normalizeBody`, at lines 268-275, and `parseEdgeLine`, at lines 240-250, unchanged — only `applyClosedInFlowFixes` itself changes):

```js
/**
 * Applies closed_in_flow fixes to both the yaml Document (in place) and the flow body string.
 * Returns the (possibly modified) body string.
 *
 * Two cases per finding:
 *   A. hasDownstream === false (terminal): remove artifact from frontmatter. If the producing
 *      process has no other outputs, remove the process too and drop the edge line. If the
 *      process has other outputs, remove only this artifact from the output list in the edge.
 *   B. hasDownstream === true and status !== done (non-terminal): the iN_ prefix on the process
 *      is permanent, so there is nothing to rename. Just clear the process's issue-tracking
 *      fields (tags, updated_at) — status is already correct from the completion commit.
 *
 * @param {import("yaml").Document} doc
 * @param {string} body
 * @param {{ type: string, processId: string, artifactId: string, hasDownstream?: boolean }[]} findings
 * @returns {string} new body string
 */
export function applyClosedInFlowFixes(doc, body, findings) {
	const closedFindings = findings.filter(
		(f) => (f.type === "closed_in_flow" || f.type === "closed_not_planned") && f.fixVia === "flow",
	);
	if (closedFindings.length === 0) return body;

	let lines = body.split("\n");

	for (const finding of closedFindings) {
		const { processId, artifactId, hasDownstream } = finding;

		if (!hasDownstream) {
			// Case A: terminal — remove artifact from frontmatter
			doc.deleteIn(["artifact", artifactId]);

			// Find the producing edge line for this process
			const edgeIdx = lines.findIndex((line) => {
				const parsed = parseEdgeLine(line);
				return parsed && parsed.process === processId && parsed.outputs.includes(artifactId);
			});

			if (edgeIdx >= 0) {
				const parsed = parseEdgeLine(lines[edgeIdx]);
				const remainingOutputs = parsed.outputs.filter((o) => o !== artifactId);

				if (remainingOutputs.length === 0) {
					// A1: sole-output process — remove process from frontmatter and drop the edge line
					doc.deleteIn(["process", processId]);
					lines.splice(edgeIdx, 1);
				} else if (remainingOutputs.length === 1) {
					// A2: multi-output, now single — rewrite as non-list
					lines[edgeIdx] = `${parsed.prefix}${remainingOutputs[0]}`;
				} else {
					// A2: multi-output — rewrite list without removed artifact
					lines[edgeIdx] = `${parsed.prefix}[${remainingOutputs.join(", ")}]`;
				}
			}
		} else {
			// Case B: non-terminal — iN_ is permanent on the process, nothing to rename.
			// Only clear the fields that stop being meaningful once the issue is closed.
			doc.deleteIn(["process", processId, "tags"]);
			doc.deleteIn(["process", processId, "updated_at"]);
		}
	}

	return normalizeBody(lines.join("\n"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='applyClosedInFlowFixes' scripts/lib/issues-flow-audit.test.mjs`
Expected: PASS, 5/5.

- [ ] **Step 5: Run the full test file**

Run: `node --test scripts/lib/issues-flow-audit.test.mjs`
Expected: PASS, all describes (`parseIssueProcesses`, `buildProcessOutputs`, `computeFindings`, `applyFixes`, `applyClosedInFlowFixes`, `normalizeBody`, `computeLabelFindings`).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/issues-flow-audit.mjs scripts/lib/issues-flow-audit.test.mjs
git commit -m "refactor(scripts): simplify non-terminal close handling now that iN_ lives on process"
```

---

### Task 6: Wire the orchestrator to process-keyed findings

**Files:**
- Modify: `scripts/audit-issues-flow.mjs:10` (import), `:62-85` (parse + consumed-ids + entry construction), `:114-134` (`printFindings` + first `computeFindings` call), `:157` (second `computeFindings` call)

**Interfaces:**
- Consumes: `parseIssueProcesses`, `buildProcessOutputs`, `computeFindings`, `applyFixes`, `applyClosedInFlowFixes` from Tasks 1-5
- Produces: no new exports — this is the `gh`-calling entry point, not unit-tested. Verified via `node --check` (syntax) here and a real read-only dry run in Task 9 (migration verification).

This script is not covered by `node:test` (it shells out to `gh`), so there's no test-first cycle — verify with `node --check` for syntax and defer functional verification to Task 9.

- [ ] **Step 1: Update the import**

Replace line 10 of `scripts/audit-issues-flow.mjs`:

```js
import { parseIssueProcesses, buildProcessOutputs, computeFindings, applyFixes, applyClosedInFlowFixes, computeLabelFindings, FLOW_LABELS } from "./lib/issues-flow-audit.mjs";
```

- [ ] **Step 2: Replace frontmatter parsing and consumed-ids logic with entry construction**

Replace lines 62-85 of `scripts/audit-issues-flow.mjs`:

```js
// --- Parse frontmatter ---

const doc = parseDocument(fmText);
const fm = doc.toJS();
const processes = parseIssueProcesses(fm);
const outputsByProcess = buildProcessOutputs(body);

// Mark artifacts that are consumed (have downstream) in the flow body
function getConsumedArtifactIds(body) {
	const consumed = new Set();
	for (const line of body.split('\n')) {
		const idx = line.indexOf('>>');
		if (idx < 0) continue;
		const left = line.slice(0, idx);
		for (const m of left.matchAll(/\b([a-z][a-z0-9_]*)\b/g)) {
			consumed.add(m[1]);
		}
	}
	return consumed;
}

const consumedIds = getConsumedArtifactIds(body);

// Expand each tracked process into one entry per (issueNumber, output artifact) pair.
// NOTE: if a single process ever has both multiple issueNumbers AND multiple outputs,
// this cross-product can pair an issue with an output it doesn't actually track (e.g.
// issue #5 closing could act on an output really tracked by issue #6). This is a known,
// accepted limitation — see docs/superpowers/specs/2026-07-04-issue-tracking-id-on-process-design.md
// ("1 processが複数出力artifactを持つ場合"). Not present in current roadmap.pfdsl data.
const entries = [];
for (const proc of processes) {
	const outputs = outputsByProcess.get(proc.id) ?? [];
	for (const issueNumber of proc.issueNumbers) {
		for (const artifactId of outputs) {
			entries.push({
				processId: proc.id,
				issueNumber,
				artifactId,
				status: fm.artifact?.[artifactId]?.status,
				hasDownstream: consumedIds.has(artifactId),
				updatedAt: proc.updatedAt,
				priorities: proc.priorities,
			});
		}
	}
}
```

- [ ] **Step 3: Update `printFindings` and the two `computeFindings` call sites**

Replace lines 111-141 of `scripts/audit-issues-flow.mjs`:

```js
// --- First pass: compute and print findings ---

let issues = fetchIssues();
let findings = computeFindings(entries, issues);

function printFindings(findings) {
	const fixable = findings.filter((f) => f.fixVia);
	const manual = findings.filter((f) => !f.fixVia);

	function fmtFinding(f) {
		const pid = f.processId ? ` [${f.processId}]` : "";
		const aid = f.artifactId ? ` -> ${f.artifactId}` : "";
		return `  #${f.issueNumber} ${f.type}${pid}${aid} ${f.detail}`;
	}

	if (fixable.length > 0) {
		console.log("fixable:");
		for (const f of fixable) console.log(fmtFinding(f));
	}
	if (manual.length > 0) {
		console.log("manual:");
		for (const f of manual) console.log(fmtFinding(f));
	}
}

if (findings.length === 0) {
	console.log("roadmap.pfdsl is in sync");
	process.exit(0);
}

printFindings(findings);
```

And replace line 157 (`findings = computeFindings(artifacts, issues);`, inside the `--fix` re-fetch pass):

```js
findings = computeFindings(entries, issues);
```

- [ ] **Step 4: Verify syntax**

Run: `node --check scripts/audit-issues-flow.mjs`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-issues-flow.mjs
git commit -m "refactor(scripts): wire audit-issues-flow orchestrator to process-keyed findings"
```

---

### Task 7: Update `github-issues-backend.md` (L3 primary source)

**Files:**
- Modify: `.claude/skills/pfd-ops/references/github-issues-backend.md:8`, `:11-14`, `:63`

**Interfaces:** none (prose only)

- [ ] **Step 1: Rewrite the id 規約 bullet (line 8)**

Old:
```
- **id 規約**: issue 対応 artifact の id は `iN_` prefix（N = issue 番号）。`iN_` id はオープン issue のみ参照する
```

New:
```
- **id 規約**: issue に対応する作業の process id は `iN_` prefix（N = issue 番号）。**恒久** — issue close 後も剥がさない。同一 process が複数 issue に対応する場合は `i40_i41_do_work` のように連結する。対応する出力 artifact の id は最初から plain（prefix なし）
```

- [ ] **Step 2: Rewrite the close 時の降格 block (lines 11-14)**

Old:
```
- **close 時の降格**: issue の `stateReason` によって挙動が異なる
  - **COMPLETED**（`Close as completed`）: 実装済みとして扱う。終端はチェーンごと削除（`closed_in_flow`）、下流入力が残るものは `iN_` prefix を外し `status: done` へ降格
  - **NOT_PLANNED**（`Close as not planned`）: 未実装のまま廃止。終端は自動削除（`closed_not_planned`）、下流入力が残るものは手動対応 finding — 下流 artifact も廃止するか代替を用意するかを人が判断する
  - **チェーンの定義**: 削除対象の「チェーン」= 当該 artifact + それを唯一生産する process + 関連 edge。process を残すと出力なき孤児 process になる（`check` は構文のみ検証し孤児を検出しないため手動で確認する）
```

New:
```
- **close 時の挙動**: issue の `stateReason` によって異なる。判定起点は process（`iN_` から issue 番号を解決し、body の edge から出力 artifact を逆引きする）
  - **COMPLETED**（`Close as completed`）: 実装済みとして扱う。終端はチェーンごと削除（`closed_in_flow`）。下流入力が残るものは process 側の `tags`/`updated_at` を削除するのみ — `iN_` prefix は恒久のため剥がさず、`status` も強制しない（マージ時に既に `done` になっている）
  - **NOT_PLANNED**（`Close as not planned`）: 未実装のまま廃止。終端は自動削除（`closed_not_planned`）、下流入力が残るものは手動対応 finding — 下流 artifact も廃止するか代替を用意するかを人が判断する
  - **チェーンの定義**: 削除対象の「チェーン」= 当該 artifact + それを唯一生産する process + 関連 edge。process を残すと出力なき孤児 process になる（`check` は構文のみ検証し孤児を検出しないため手動で確認する）
```

- [ ] **Step 3: Rewrite 採用手順 step 4 (line 63)**

Old:
```
4. `roadmap.pfdsl` を依存構造のみのグラフとして用意し、issue artifact に `iN_` prefix を付ける
```

New:
```
4. `roadmap.pfdsl` を依存構造のみのグラフとして用意し、issue に対応する process に `iN_` prefix を付ける
```

- [ ] **Step 4: Check for the CI markdown-linebreak rule**

Run: `grep -n "check-md-linebreaks" Makefile scripts/*.mjs 2>/dev/null | head -5` to confirm the checker script location, then run it against this file (exact invocation depends on what that grep reveals — the project's `check-md-linebreaks` CI job enforces line breaks only at sentence boundaries; all three edits above already respect that).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/pfd-ops/references/github-issues-backend.md
git commit -m "docs(pfd-ops): move iN_ issue-tracking convention from artifact to process"
```

---

### Task 8: Update `architecture.md` (L3 summary)

**Files:**
- Modify: `.claude/skills/pfd-ops/references/architecture.md:58-63`

**Interfaces:** none (prose only)

- [ ] **Step 1: Rewrite the 主な規約 bullet list**

Old (lines 58-63):
```
主な規約:
- issue が一次情報。`roadmap.pfdsl` は依存構造のみ管理
- artifact id は `iN_` prefix（N = issue 番号）。オープン issue のみ参照
- `flow:managed` / `flow:exempt` ラベルで管理対象を分類
- issue close 時: 終端はチェーンごと削除、下流入力が残るものは prefix を外し一般 done artifact へ降格
- `audit-issues-flow.mjs` で同期監査・機械修復
```

New:
```
主な規約:
- issue が一次情報。`roadmap.pfdsl` は依存構造のみ管理
- process id は `iN_` prefix（N = issue 番号）。恒久 — issue close 後も剥がさない。出力 artifact id は最初から plain
- `flow:managed` / `flow:exempt` ラベルで管理対象を分類
- issue close 時: 終端はチェーンごと削除、下流入力が残るものは process 側の `tags`/`updated_at` のみ削除
- `audit-issues-flow.mjs` で同期監査・機械修復
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/pfd-ops/references/architecture.md
git commit -m "docs(pfd-ops): update L3 architecture summary for process-based issue tracking"
```

---

### Task 9: Update the auto-PR workflow wording (both mirrors)

**Files:**
- Modify: `.github/workflows/flow-on-issue-close.yml:54`
- Modify: `.claude/skills/pfd-ops/install/.github/workflows/flow-on-issue-close.yml:54` (identical edit — CI enforces byte-identity between these two files, ADR-0016)

**Interfaces:** none (PR body text only)

- [ ] **Step 1: Edit both files identically**

Old (line 54, both files):
```
            Terminal chains are removed (artifact + sole producing process + edge); artifacts with remaining downstream are demoted by stripping the `iN_` prefix. Review and merge if correct.
```

New (line 54, both files):
```
            Terminal chains are removed (artifact + sole producing process + edge); processes with remaining downstream outputs only have their `tags`/`updated_at` issue-tracking fields cleared (the `iN_` prefix on the process is permanent). Review and merge if correct.
```

- [ ] **Step 2: Verify the two files are still byte-identical**

Run: `diff .github/workflows/flow-on-issue-close.yml .claude/skills/pfd-ops/install/.github/workflows/flow-on-issue-close.yml`
Expected: no output (files identical).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/flow-on-issue-close.yml .claude/skills/pfd-ops/install/.github/workflows/flow-on-issue-close.yml
git commit -m "docs(pfd-ops): update flow-on-issue-close PR body wording for process-based demotion"
```

---

### Task 10: Migrate the 10 currently-open `iN_` chains in `.pfdsl/roadmap.pfdsl`

**Files:**
- Create (scratch, not committed): `/private/tmp/claude-501/-Users-m5-works-pfdsl/9a9ab15b-9c54-46a8-8653-f9a72af6aaab/scratchpad/migrate-issue-tracking-ids.mjs`
- Modify: `.pfdsl/roadmap.pfdsl` (output of running the scratch script)

**Interfaces:** none — this is a one-off data migration, not library code.

The 10 mappings (verified zero id collisions in both directions in prior research):

| old artifact id | new artifact id | old process id | new process id |
|---|---|---|---|
| `i119_published_extension` | `published_extension` | `publish_extension` | `i119_publish_extension` |
| `i12_article` | `article` | `write_article` | `i12_write_article` |
| `i3_obsidian_plugin` | `obsidian_plugin` | `build_obsidian_plugin` | `i3_build_obsidian_plugin` |
| `i268_type_field` | `type_field` | `implement_type_field` | `i268_implement_type_field` |
| `i272_w002_hierarchy` | `w002_hierarchy` | `implement_w002_hierarchy` | `i272_implement_w002_hierarchy` |
| `i273_blocked_by` | `blocked_by` | `implement_blocked_by` | `i273_implement_blocked_by` |
| `i278_release_automation` | `release_automation` | `implement_release_automation` | `i278_implement_release_automation` |
| `i299_diag_registry` | `diag_registry` | `implement_diag_registry` | `i299_implement_diag_registry` |
| `i300_spec_editorial` | `spec_editorial` | `revise_spec_editorial` | `i300_revise_spec_editorial` |
| `i304_extends_probe` | `extends_probe` | `probe_extends_spec` | `i304_probe_extends_spec` |

For each pair, `tags`/`updated_at` move from the artifact block to the process block (only `i299_diag_registry` currently has `tags: [ "priority:high" ]`; the other 9 have only `updated_at`). All other artifact fields (`label`, `description`, `status`, `criteria`) and process fields (`label`, `location`) are untouched.

Worked example (`i119_published_extension` / `publish_extension`), before:

```yaml
artifact:
  i119_published_extension:
    label: "Marketplace 公開済み extension (#119)"
    description: "VS Marketplace は OIDC/Trusted Publishing 非対応のため PAT が必要。VSCE_PAT 環境変数を設定して `make release-extension` でローカル実行する"
    status: wip
    criteria: "`VSCE_PAT` を設定した `make release-extension` で VS Code Marketplace への publish が動作確認済み"
    updated_at: 2026-06-29T01:43:14Z
# ...
process:
  publish_extension:
    label: extension自動公開実装
    location: https://github.com/takasek/pfdsl/issues/119
```

after:

```yaml
artifact:
  published_extension:
    label: "Marketplace 公開済み extension (#119)"
    description: "VS Marketplace は OIDC/Trusted Publishing 非対応のため PAT が必要。VSCE_PAT 環境変数を設定して `make release-extension` でローカル実行する"
    status: wip
    criteria: "`VSCE_PAT` を設定した `make release-extension` で VS Code Marketplace への publish が動作確認済み"
# ...
process:
  i119_publish_extension:
    label: extension自動公開実装
    location: https://github.com/takasek/pfdsl/issues/119
    updated_at: 2026-06-29T01:43:14Z
```

(Labels keep their `(#119)` suffix — those are prose, not ids, and are out of scope for this migration.)

- [ ] **Step 1: Write the migration script**

Write `/private/tmp/claude-501/-Users-m5-works-pfdsl/9a9ab15b-9c54-46a8-8653-f9a72af6aaab/scratchpad/migrate-issue-tracking-ids.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";

const path = "/Users/m5/works/pfdsl/.pfdsl/roadmap.pfdsl";
const raw = readFileSync(path, "utf-8");
const lines = raw.split("\n");
let fmEnd = -1;
for (let i = 1; i < lines.length; i++) {
	if (lines[i].trimEnd() === "---") {
		fmEnd = i;
		break;
	}
}
const fmText = lines.slice(1, fmEnd).join("\n") + "\n";
let body = lines.slice(fmEnd + 1).join("\n");

const doc = parseDocument(fmText);

// [oldArtifactId, newArtifactId, oldProcessId, newProcessId]
const migrations = [
	["i119_published_extension", "published_extension", "publish_extension", "i119_publish_extension"],
	["i12_article", "article", "write_article", "i12_write_article"],
	["i3_obsidian_plugin", "obsidian_plugin", "build_obsidian_plugin", "i3_build_obsidian_plugin"],
	["i268_type_field", "type_field", "implement_type_field", "i268_implement_type_field"],
	["i272_w002_hierarchy", "w002_hierarchy", "implement_w002_hierarchy", "i272_implement_w002_hierarchy"],
	["i273_blocked_by", "blocked_by", "implement_blocked_by", "i273_implement_blocked_by"],
	["i278_release_automation", "release_automation", "implement_release_automation", "i278_implement_release_automation"],
	["i299_diag_registry", "diag_registry", "implement_diag_registry", "i299_implement_diag_registry"],
	["i300_spec_editorial", "spec_editorial", "revise_spec_editorial", "i300_revise_spec_editorial"],
	["i304_extends_probe", "extends_probe", "probe_extends_spec", "i304_probe_extends_spec"],
];

for (const [oldArt, newArt, oldProc, newProc] of migrations) {
	// Reuse the existing YAML map nodes (not toJSON()) to preserve scalar
	// quoting/styling exactly, matching the approach used elsewhere in
	// scripts/lib/issues-flow-audit.mjs's applyClosedInFlowFixes.
	const artNode = doc.getIn(["artifact", oldArt]);
	const updatedAt = doc.getIn(["artifact", oldArt, "updated_at"]);
	const tags = doc.getIn(["artifact", oldArt, "tags"]);
	doc.deleteIn(["artifact", oldArt, "updated_at"]);
	doc.deleteIn(["artifact", oldArt, "tags"]);
	doc.deleteIn(["artifact", oldArt]);
	doc.setIn(["artifact", newArt], artNode);

	const procNode = doc.getIn(["process", oldProc]);
	doc.deleteIn(["process", oldProc]);
	doc.setIn(["process", newProc], procNode);
	if (updatedAt !== undefined) doc.setIn(["process", newProc, "updated_at"], updatedAt);
	if (tags !== undefined) doc.setIn(["process", newProc, "tags"], tags);

	const reArt = new RegExp(`\\b${oldArt}\\b`, "g");
	const reProc = new RegExp(`\\b${oldProc}\\b`, "g");
	body = body.replace(reArt, newArt).replace(reProc, newProc);
}

const newRaw = "---\n" + doc.toString({ lineWidth: 0 }) + "---\n" + body;
writeFileSync(path, newRaw, "utf-8");
console.log("migrated 10 chains");
```

- [ ] **Step 2: Run it**

Run: `cd /Users/m5/works/pfdsl && node /private/tmp/claude-501/-Users-m5-works-pfdsl/9a9ab15b-9c54-46a8-8653-f9a72af6aaab/scratchpad/migrate-issue-tracking-ids.mjs`
Expected: `migrated 10 chains`

- [ ] **Step 3: Review the diff**

Run: `git diff --stat .pfdsl/roadmap.pfdsl`
Expected: one file changed. Then inspect the full diff (`git diff .pfdsl/roadmap.pfdsl`) to confirm: exactly 10 artifact ids renamed, 10 process ids renamed, `updated_at`/`tags` moved (not duplicated), all edge lines updated, no unrelated lines touched.

- [ ] **Step 4: Validate the migrated file**

Run: `npx @pfdsl/cli check .pfdsl/roadmap.pfdsl`
Expected: exit 0, no errors.

Run: `npx @pfdsl/cli graph .pfdsl/roadmap.pfdsl > /dev/null`
Expected: exit 0.

- [ ] **Step 5: Discard the scratch script (it is not part of the repo)**

The script lives under the scratchpad directory, outside the repo — no cleanup action needed in the repo itself.

- [ ] **Step 6: Commit**

```bash
git add .pfdsl/roadmap.pfdsl
git commit -m "chore(roadmap): migrate iN_ issue-tracking prefix from artifact to process"
```

---

### Task 11: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full rewritten test suite**

Run: `node --test scripts/lib/issues-flow-audit.test.mjs`
Expected: PASS, all tests green (7 `parseIssueProcesses` + 4 `buildProcessOutputs` + 21 `computeFindings` + 5 `applyFixes` + 5 `applyClosedInFlowFixes` + 5 `normalizeBody` + 5 `computeLabelFindings` = 52 tests).

- [ ] **Step 2: Confirm install/ mirror identity**

Run: `diff -rq -x CLAUDE.md .claude/skills/pfd-ops/install .`
Expected: only reports differences for files legitimately outside the install/ mirror scope (this command's exact form should be validated against how `check-pfd-ops-sync.yml` invokes it — read that workflow file if the diff output looks unexpected). At minimum, confirm no diff on `flow-on-issue-close.yml` specifically (already checked in Task 9 Step 2).

- [ ] **Step 3: Review `.pfdsl/roadmap.md` line 36 gate item**

Read `.pfdsl/roadmap.md` around line 36 (`- [ ] close 時の降格規則を適用した（定義は L3 reference。専属 process も含めて削除する）`). This wording defers to the L3 reference and doesn't restate the old rule — confirm no edit is needed here (decision recorded in this plan, not a silent skip).

- [ ] **Step 4: Read-only dry run of the orchestrator against the real, migrated repo**

Run: `node scripts/audit-issues-flow.mjs` (no `--fix`)
Expected: either `roadmap.pfdsl is in sync` (exit 0) or a list of findings referencing the new plain artifact ids and `iN_`-prefixed process ids (exit 1) — confirms the orchestrator wiring from Task 6 works end-to-end against real `gh` data and the migrated file from Task 10. If it lists findings, inspect them manually to confirm they're pre-existing sync issues unrelated to this migration (e.g. stale `updated_at`), not migration bugs.

- [ ] **Step 5: Thought experiments from the design doc's 検証 section**

Confirm by inspection of the Task 5 code: a terminal issue close removes the chain identically whether resolved via process or (as before) via artifact — the only change is the lookup key. Confirm a non-terminal issue close now only clears `tags`/`updated_at` and leaves both ids and `status` untouched.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-04-issue-tracking-id-on-process-design.md`):
- 新規約 (§"新規約") → Tasks 1, 3, 5 implement the permanent-prefix, plain-artifact-id contract.
- terminal 変更なし (§"terminal") → Task 5 Step 3 keeps Case A logic, only re-keyed by processId.
- 非terminal 縮小 (§"非terminal") → Task 5 Step 3 Case B, no rename/no status-force.
- audit script改修 (§"audit script改修") → Tasks 1, 2, 3, 5, 6 cover `parseIssueArtifacts`→`parseIssueProcesses`, output resolution via edges, and both `applyClosedInFlowFixes` cases.
- ドキュメント更新 (§"ドキュメント更新", 4 targets) → Tasks 7, 8, 9 (workflow + install mirror counts as one target with two files), and Task 11 Step 3 for roadmap.md.
- 移行 (§"移行") → Task 10.
- 既存ADRとの関係 (§"既存ADRとの関係") → no new ADR, nothing to implement.
- スコープ判定 (§"スコープ判定") → captured in Global Constraints, no issue/roadmap-chain task added.
- 検証 (§"検証") → Task 11.
- 複数出力/複数issue processの扱い (§"1 processが複数出力artifactを持つ場合") → Task 1 Step 1's concatenated-prefix test, Task 3's multi-output independent-findings test, Task 6 Step 2's documented cross-product limitation comment.
- 自動PR対応 (§"flow-on-issue-close.ymlの自動PR") → no code/doc change required (design doc concluded: leave stray PRs unmerged, they self-resolve) — correctly has no task.

**Placeholder scan:** no TBD/TODO; every step shows complete, runnable code or an exact command with expected output.

**Type/signature consistency:**
- `parseIssueProcesses(frontmatter) -> {id, issueNumbers, updatedAt, priorities}[]` (Task 1) is consumed by the orchestrator (Task 6), not by `computeFindings` directly — confirmed consistent across both tasks.
- `buildProcessOutputs(body) -> Map<string,string[]>` (Task 2) consumed identically in Task 6.
- `computeFindings(entries, issues)` entry shape `{processId, issueNumber, artifactId, status, hasDownstream, updatedAt, priorities}` matches exactly between Task 3's tests, Task 6's orchestrator construction, and what Tasks 4/5 read off the resulting findings (`processId`, `artifactId`, `hasDownstream`).
- `applyFixes`/`applyClosedInFlowFixes` signatures (`(doc, findings, issuesByNumber)` / `(doc, body, findings)`) are unchanged from the original file — only their internal field usage moved from `artifactId` to `processId` where appropriate.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-05-issue-tracking-id-on-process-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
