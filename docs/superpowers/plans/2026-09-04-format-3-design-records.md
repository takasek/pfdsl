# Format 3 Reader-first Design Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-proposal reader-first record with a versioned format that presents every decided axis first and records original-option dispositions, premise tests, and pre-implementation revisions without claiming semantic guarantees from structural checks.

**Architecture:** `scripts/lib/gate-check.mjs` remains the source of truth for the three format generations, parses format 3 into a small structural result, rejects ambiguous format 3 records, and keeps semantic review outside the blocking verdict. `scripts/lib/cycle-status.mjs` emits the format 3 template from the shared contract, while canonical pfd-ops references define the dialogue order and human-review boundary before generators project them to every Claude and Codex mirror.

**Tech Stack:** Node.js ESM, `node:test`, Markdown skills, pfdsl CLI, repository generation scripts.

**Spec:** `docs/superpowers/specs/2026-08-30-reader-first-design-records-design.md`

## Global Constraints

- Format 1 cutoff is exactly `2026-08-30T09:32:50Z`.
- Format 2 is valid from `2026-08-30T09:32:50Z` through `2026-08-31T01:30:23Z`.
- Format 3 cutoff is exactly `2026-08-31T01:30:24Z`.
- Records created at or after the format 3 cutoff must contain `設計記録形式: 3` and the complete format 3 structure.
- The only normative decision text is the list under `決定:`; every later section is rationale or audit evidence.
- Format 3 uses the display kinds `実装`, `調査のみ`, `待機`, and `実装しない`, but no kind grants authority or permission.
- Original options occur only under `案の処分:`; premise-test alternatives occur only in their `前提検査 Pn` block.
- Format 3 does not use issue-derived `optionCount` as a blocking completeness claim.
- Multiple complete format 3 comments fail closed; replacement by a second comment is outside this change.
- Machine checks report structural conformance, not design validity.
- Edit canonical sources only, then regenerate all delivery mirrors.

---

### Task 1: Parse and select format 3 records

**Files:**
- Modify: `.pfdsl/roadmap.pfdsl`
- Modify: `scripts/lib/gate-check.mjs`
- Modify: `scripts/lib/gate-check.test.mjs`
- Modify: `scripts/lib/gate-check-steps.mjs`
- Modify: `scripts/lib/gate-check-steps.test.mjs`

**Interfaces:**
- Produces: `DESIGN_RECORD_V2_CUTOFF`, `DESIGN_RECORD_V3_CUTOFF`, `FORMAT_3_MARKER`, `FORMAT_3_DECISION_KINDS`, and `FORMAT_3_DISPOSITIONS`.
- Produces: `parseFormat3DesignRecord(body)` returning `{status: "PASS", axes: string[], allNoImplementation: boolean}` or `{status: "FAIL", problems: string[]}`.
- Produces: `resolveDesignRecord(entries)` returning `{status: "selected", record}`, `{status: "invalid", record, problems}`, `{status: "none"}`, or `{status: "ambiguous", detail}`.
- Preserves: format 1 and format 2 grandfathering, Markdown line-head normalization, record edit-history lookup, and the rule that incomplete newer fragments do not shadow a complete older record.

- [ ] **Step 1: Reopen the roadmap artifact before implementation**

Run:

```bash
node packages/cli/dist/cli.js meta set .pfdsl/roadmap.pfdsl reader_first_design_records status wip
```

Update the artifact description and criteria so they name the version 3 decision-first structure, three-generation migration, and structural-only gate verdict.

- [ ] **Step 2: Add failing parser tests**

Add a `format3Record()` test helper that returns this smallest complete record:

```js
function format3Record() {
	return [
		"設計記録形式: 3",
		"決定:",
		"- 保存方式（実装）: Aを段階導入する",
		"理由:",
		"- 保存方式: 障害範囲を限定できる",
		"案の処分:",
		"- 部分採用 — 元候補「A」— 採用部分: 索引; 残部: 保留 — 負荷計測後に再検討",
		"前提検査 P1:",
		"対象: 保存方式 / A",
		"前提: 保存方式と通知方式を同時に変える必要がある",
		"前提を外した案: 保存方式だけを段階導入する",
		"既存候補との差分: 元候補は両方式を一組としていた",
		"検査案の処分 P1: 採用 — 今回の決定に含める",
		"改訂履歴:",
		"- なし",
	].join("\n");
}
```

Test a valid single-axis record, multiple decision axes, every display kind, every disposition, a partial adoption missing its remainder, mismatched decision and rationale axis sets, duplicate axes, missing and out-of-order sections, empty values, missing and duplicate premise-test numbers, template placeholders, and conflicting initial and revised history rows.

- [ ] **Step 3: Add failing generation-selection tests**

Cover the format 1 cutoff, both edges of the format 2 interval, the format 3 cutoff, coexistence of one complete format 3 record with complete older records, an incomplete format 3 fragment beside a complete format 2 record, an invalid timestamp, and two complete format 3 comments.

Assert that two complete format 3 comments return:

```js
{
	status: "ambiguous",
	detail: "multiple complete format 3 design records",
}
```

- [ ] **Step 4: Run targeted tests and verify RED**

Run:

```bash
node --test scripts/lib/gate-check.test.mjs scripts/lib/gate-check-steps.test.mjs
```

Expected: FAIL because the format 3 constants, parser, and ambiguity result do not exist.

- [ ] **Step 5: Implement the minimal structural parser**

Add constants with the exact cutoff and vocabulary from the spec.
Parse line heads and section boundaries without interpreting rationale prose, candidate identity, or semantic consistency.
Require exact decision and rationale axis-set equality because both sets come from explicit format 3 labels.
For `部分採用`, require non-empty `採用部分:` and `残部: 却下|保留` segments, but leave their adequacy to human review.

```js
export const DESIGN_RECORD_V2_CUTOFF = "2026-08-30T09:32:50Z";
export const DESIGN_RECORD_V3_CUTOFF = "2026-08-31T01:30:24Z";
export const FORMAT_3_MARKER = "設計記録形式: 3";
export const FORMAT_3_DECISION_KINDS = ["実装", "調査のみ", "待機", "実装しない"];
export const FORMAT_3_DISPOSITIONS = ["採用", "部分採用", "保留", "却下"];
```

- [ ] **Step 6: Implement fail-closed selection and effective timing**

Implement `resolveDesignRecord(entries)` so exactly one complete format 3 record outranks complete format 2 and format 1 records, while two complete format 3 records return `ambiguous`.
Keep incomplete or timestamp-invalid records available for diagnostics only when no complete valid generation exists.
In `designRecordStep`, treat ambiguity as FAIL and compare the first implementation commit with the later of the selected comment's valid `createdAt` and resolved `lastEditedAt`.
Only let format 3 skip the no-implementation timing path when every decision axis has kind `実装しない`.

- [ ] **Step 7: Run targeted tests and verify GREEN**

Run:

```bash
node --test scripts/lib/gate-check.test.mjs scripts/lib/gate-check-steps.test.mjs
```

Expected: PASS for all three generations, format 3 structure, ambiguity handling, edit timing, and all-no-implementation behavior.

- [ ] **Step 8: Commit the machine contract**

Commit subject: `feat(pfd-ops): validate format 3 design records`

### Task 2: Emit and classify the format 3 template

**Files:**
- Modify: `scripts/lib/cycle-status.mjs`
- Modify: `scripts/lib/cycle-status.test.mjs`
- Modify: `scripts/lib/cycle-status-steps.test.mjs`

**Interfaces:**
- Consumes: `FORMAT_3_MARKER`, `FORMAT_3_DECISION_KINDS`, `FORMAT_3_DISPOSITIONS`, `parseFormat3DesignRecord`, and `resolveDesignRecord` from Task 1.
- Produces: `buildDesignRecordTemplate()` with one copyable format 3 record and no generated `案の処分 N:` rows.
- Preserves: unsettled-phrase detection and fail-closed behavior when the issue does not expose an enumerated-options structure.

- [ ] **Step 1: Add failing template tests**

Assert that `buildDesignRecordTemplate().lines` equals a complete single-axis format 3 template, including `改訂履歴:\n- なし`, and does not change when `optionCount` changes.
Assert that its note says candidate completeness and semantic consistency remain human-review responsibilities.

- [ ] **Step 2: Add failing settlement tests**

Test complete format 1, format 2, and format 3 records at their valid timestamps; a post-cutoff format 2 record; incomplete format 3; two complete format 3 comments; and a format 3 record whose decision and rationale axes differ.
Require ambiguity and structural invalidity to report `unsettled: true` with distinct reasons.

- [ ] **Step 3: Run targeted tests and verify RED**

Run:

```bash
node --test scripts/lib/cycle-status.test.mjs scripts/lib/cycle-status-steps.test.mjs
```

Expected: FAIL because cycle-status still emits the four-line format 2 record and cannot report format 3 ambiguity.

- [ ] **Step 4: Emit the format 3 template from shared constants**

Make the generated lines start exactly as follows and include the remaining premise-test and revision fields from the spec:

```js
const lines = [
	FORMAT_3_MARKER,
	"",
	"決定:",
	`- <軸名>（<${FORMAT_3_DECISION_KINDS.join(" | ")}>）: <今回確定した範囲>`,
	"",
	"理由:",
	"- <軸名>: <目的との対応>",
];
```

Remove numbered disposition generation based on `optionCount`.
Retain option enumeration only as diagnostic context and explain that the operator must dispose every actual original candidate by name.

- [ ] **Step 5: Use the shared resolver for settlement**

Update `classifyDesignSettlement` to consume `resolveDesignRecord` and the format-specific structural verdict.
Return `record-ambiguous` for multiple complete format 3 comments and `record-incomplete` with structural problems for invalid format 3.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run:

```bash
node --test scripts/lib/cycle-status.test.mjs scripts/lib/cycle-status-steps.test.mjs
```

Expected: PASS for the emitted template, three-generation settlement, ambiguity, incomplete structure, and option-count independence.

- [ ] **Step 7: Commit the template change**

Commit subject: `feat(pfd-ops): emit format 3 design template`

### Task 3: Replace the canonical human-facing contract

**Files:**
- Modify: `.claude/skills/pfd-ops/references/work-cycle.md`
- Modify: `.claude/skills/pfd-ops/references/github-issues-backend.md`
- Modify: `.claude/skills/pfd-ops/references/file-based-tracker-backend.md`
- Test: `scripts/lib/pfd-ops-applicability.test.mjs`

**Interfaces:**
- Consumes: the exact format 3 vocabulary, cutoff, and structural versus human-review boundary from Tasks 1 and 2.
- Produces: dialogue guidance that presents every decision axis and rationale first, then records original-option dispositions and premise tests without claiming semantic machine proof.

- [ ] **Step 1: Add failing contract tests**

Extend `pfd-ops-applicability.test.mjs` to require `設計記録形式: 3`, the decision-first ordering, named original-option dispositions, `前提検査 Pn`, the human-review boundary, and the prohibition on second-comment replacement.
Require the old mandatory four-line format 2 wording to be absent from the active post-cutoff instructions while remaining documented as migration history.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
node --test scripts/lib/pfd-ops-applicability.test.mjs
```

Expected: FAIL because canonical references still require format 2.

- [ ] **Step 3: Rewrite the canonical work-cycle contract**

Keep the existing premise-negation reasoning discipline, empirical evidence requirements, and invalid-rejection-reason rules.
Replace the persisted record recipe and terminal checklist with the format 3 structure.
State explicitly that the machine checks structure only and enumerate the human checks from the spec.
State that candidate names are written directly, generated test alternatives live only in their premise-test block, and `optionCount` is not evidence of completeness.

- [ ] **Step 4: Update both tracker backends**

For the GitHub backend, document the three generation intervals, format 3 persistence, same-comment pre-commit revision rule, last-edit timing, and fail-closed handling of multiple complete format 3 comments.
For the file backend, require format 3 for every newly written record and retain its commit-based persistence boundary without introducing GitHub comment timestamps or edit semantics.

- [ ] **Step 5: Run Markdown and contract checks**

Run:

```bash
node scripts/check-md-linebreaks.mjs .claude/skills/pfd-ops/references/work-cycle.md .claude/skills/pfd-ops/references/github-issues-backend.md .claude/skills/pfd-ops/references/file-based-tracker-backend.md
node --test scripts/lib/pfd-ops-applicability.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the canonical contract**

Commit subject: `docs(pfd-ops): generalize reader-first decisions`

### Task 4: Regenerate, pressure-test, and complete the artifact

**Files:**
- Regenerate: `.agents/skills/pfd-ops/**`
- Regenerate: `plugin/pfdsl/skills/pfd-ops/**`
- Regenerate: `plugin/pfdsl-codex/skills/pfd-ops/**`
- Regenerate: `plugin/pfdsl/.claude-plugin/bundle-manifest.json`
- Regenerate: `.claude/skills/pfd-ops/install/**` only when the canonical generator changes it.
- Modify: `.pfdsl/roadmap.pfdsl` status for `reader_first_design_records` from `wip` to `done` after every criterion passes.

**Interfaces:**
- Consumes: canonical references and machine contracts from Tasks 1 through 3.
- Produces: byte-consistent delivery mirrors, controlled same-prompt evidence for the before/after ordering change, independent evidence that the decision-first order survives representative decision shapes, and a completed roadmap artifact.

- [ ] **Step 1: Regenerate canonical projections**

Run:

```bash
make gen-plugin
```

Expected: generated mirrors change only where the canonical pfd-ops contract and bundle manifest project them.

- [ ] **Step 2: Verify generation identity**

Run:

```bash
node scripts/check-generated-drift.mjs -- generated plugin .claude-plugin/marketplace.json AGENTS.md .agents .codex
node scripts/check-generated-drift.mjs -- .claude/skills/pfd-ops/install
```

Expected: PASS with no drift.

- [x] **Step 3: Run fresh-context pressure scenarios**

Run five samples each for a bounded single-axis change, a two-axis mixed `実装` and `待機` decision, and a partial-adoption decision.
Use only the updated canonical `work-cycle.md` as operational context.

Expected: all 15 responses present every decision axis before candidate dispositions or premise tests, preserve the selected and remaining portions of partial adoption, and do not describe structural conformance as design validity.

These 15 samples are shape coverage, not before/after evidence.

- [x] **Step 3a: Run a controlled same-prompt comparison**

Reconstruct one bounded-change prompt only from facts common to all five historical responses, because the retained historical task payload is encrypted and cannot be reused as a direct comparator.
Use one prompt, the stated runtime conditions, the identified old and new contract revisions and hashes, and one explicit order classifier for five fresh contexts per contract.
Preserve every input, complete response, and reproducible classification in `docs/superpowers/reports/2026-09-05-format-3-controlled-comparison.md`, while noting that the report was assembled afterward and does not independently prove preregistration or timing.

Result: the newly controlled old cohort is decision-first in 1/5 responses and the newly controlled current cohort is decision-first in 5/5 responses; the historical 1/5 remains provenance-limited reference evidence only.
This controlled comparison is retrospective remediation and did not gate the earlier transition of `reader_first_design_records` to `done` or its downstream readiness.

- [ ] **Step 4: Run targeted and repository-wide verification**

Run:

```bash
node --test scripts/lib/gate-check.test.mjs scripts/lib/gate-check-steps.test.mjs scripts/lib/cycle-status.test.mjs scripts/lib/cycle-status-steps.test.mjs scripts/lib/pfd-ops-applicability.test.mjs
pnpm -r test
make check-docs
node scripts/gate-check.mjs --base main --artifact reader_first_design_records --issue 1076
```

Expected: all tests and gates pass; issue #1076's pre-format-2 legacy record remains valid and incomplete newer fragments cannot shadow it.

- [ ] **Step 5: Perform the human semantic review**

Review the format 3 fixtures and generated template for original-candidate coverage, decision-disposition consistency, partial-adoption boundaries, executable reconsideration conditions, valid rejection reasons, premise scope, same-granularity alternatives, and truthful revision history.

Expected: no fixture relies on the machine verdict as proof of semantic validity.

- [ ] **Step 6: Mark the roadmap artifact done**

Run:

```bash
node packages/cli/dist/cli.js meta set .pfdsl/roadmap.pfdsl reader_first_design_records status done
```

Expected: the artifact becomes done only after template, gate, mirrors, pressure scenarios, and human semantic review satisfy the updated criteria.

- [ ] **Step 7: Commit and push the completion unit**

Commit subject: `chore(pfd-ops): complete format 3 rollout`

Push `codex/issue-1076-reader-first-design` to update PR #1078.
Prepare the exact revised PR body for approval before changing the public PR description, then reread the persisted body after any approved update.
