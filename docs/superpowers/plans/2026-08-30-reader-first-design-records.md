# Reader-first Design Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pfd-ops design dialogue and persisted selection records start with the proposal and rationale while preserving premise-negation review and legacy records.

**Architecture:** `scripts/lib/gate-check.mjs` owns the new and legacy prefix sets, the fixed migration cutoff, format selection, and content classification. `scripts/lib/cycle-status.mjs` consumes those contracts to emit only the new reader-first template, while canonical pfd-ops references define the human-facing order and generators project the change to every Claude/Codex mirror.

**Tech Stack:** Node.js ESM, `node:test`, Markdown skills, pfdsl CLI, repository generation scripts.

**Spec:** `docs/superpowers/specs/2026-08-30-reader-first-design-records-design.md`

## Global Constraints

- Migration cutoff is exactly `2026-08-30T09:32:50Z`.
- Records created before the cutoff may use the old `前提:` / `否定案:` / `却下理由:` contract.
- Records created at or after the cutoff must use `提案:` / `理由:` / `前提を外した対案:` / `対案を採らない理由:`.
- A new-format candidate outranks a legacy candidate when both exist.
- `案の処分 N:` and `実装しない:` retain their current semantics.
- Edit canonical sources only, then regenerate all delivery mirrors.

---

### Task 1: Version the machine-readable design-record contract

**Files:**
- Modify: `scripts/lib/gate-check.mjs`
- Modify: `scripts/lib/gate-check.test.mjs`
- Modify: `scripts/lib/gate-check-steps.mjs`
- Modify: `scripts/lib/gate-check-steps.test.mjs`

**Interfaces:**
- Produces: `READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES`, `LEGACY_DESIGN_RECORD_REQUIRED_PREFIXES`, `DESIGN_RECORD_FORMAT_CUTOFF`, and a helper that resolves the required prefix set from `{body, createdAt}`.
- Preserves: `selectDesignRecord(entries)`, `classifyDesignRecordContent(...)`, timing validation, numbered dispositions, and no-implementation detection.

- [ ] **Step 1: Add failing cutoff and precedence tests**

Add tests covering a complete legacy comment at `2026-08-30T09:32:49Z`, the same legacy body at `2026-08-30T09:32:50Z`, a complete reader-first body after the cutoff, an incomplete reader-first body, and a reader-first candidate competing with a legacy candidate.

```js
const readerFirst = [
	"提案: x",
	"理由: y",
	"前提を外した対案: z",
	"対案を採らない理由: owner constraint",
].join("\n");
const legacy = ["前提: x", "否定案: y", "却下理由: z"].join("\n");
```

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `node --test scripts/lib/gate-check.test.mjs scripts/lib/gate-check-steps.test.mjs`

Expected: FAIL because the new constants and cutoff-aware classification do not exist and post-cutoff legacy records still pass.

- [ ] **Step 3: Implement the minimal versioned contract**

Define the exact cutoff and both prefix arrays, make record selection prefer any reader-first candidate, grandfather legacy-only candidates only before the cutoff, and pass the selected record timestamp into content classification.

```js
export const DESIGN_RECORD_FORMAT_CUTOFF = "2026-08-30T09:32:50Z";
export const READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES = [
	"提案:",
	"理由:",
	"前提を外した対案:",
	"対案を採らない理由:",
];
export const LEGACY_DESIGN_RECORD_REQUIRED_PREFIXES = [
	"前提:",
	"否定案:",
	"却下理由:",
];
```

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `node --test scripts/lib/gate-check.test.mjs scripts/lib/gate-check-steps.test.mjs`

Expected: PASS with cutoff boundary, precedence, timing, disposition, and Markdown normalization tests green.

- [ ] **Step 5: Commit the machine contract**

Commit subject: `feat(pfd-ops): version design record format`

### Task 2: Emit the reader-first template

**Files:**
- Modify: `scripts/lib/cycle-status.mjs`
- Modify: `scripts/lib/cycle-status.test.mjs`
- Modify: `scripts/lib/cycle-status-steps.test.mjs`

**Interfaces:**
- Consumes: `READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES` and cutoff-aware record helpers from Task 1.
- Produces: `buildDesignRecordTemplate()` whose first four lines are the reader-first contract in canonical order.

- [ ] **Step 1: Add failing template and classification tests**

Assert that `buildDesignRecordTemplate().lines.slice(0, 4)` equals the four new reader-first labels and that settlement accepts a pre-cutoff legacy record but reports the new missing prefixes for a post-cutoff legacy record.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `node --test scripts/lib/cycle-status.test.mjs scripts/lib/cycle-status-steps.test.mjs`

Expected: FAIL because the template begins with `前提:` and settlement has no cutoff-aware contract.

- [ ] **Step 3: Implement the minimal template and classification changes**

Build the four lines from the Task 1 constant, keep numbered disposition lines unchanged, and update the note so it names the reader-first meanings without reintroducing the old display order.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `node --test scripts/lib/cycle-status.test.mjs scripts/lib/cycle-status-steps.test.mjs`

Expected: PASS for new template, legacy grandfathering, new-format settlement, and incomplete-record reporting.

- [ ] **Step 5: Commit the template change**

Commit subject: `feat(pfd-ops): emit reader-first design template`

### Task 3: Change the canonical human-facing skill contract

**Files:**
- Modify: `.claude/skills/pfd-ops/references/work-cycle.md`
- Modify: `.claude/skills/pfd-ops/references/github-issues-backend.md`
- Modify: `.claude/skills/pfd-ops/references/file-based-tracker-backend.md`

**Interfaces:**
- Consumes: the exact four reader-first labels and cutoff defined by Tasks 1 and 2.
- Produces: dialogue guidance that starts with proposal and rationale and persistence guidance that records the same meanings in public.

- [ ] **Step 1: Use the recorded five-sample baseline as RED**

Confirm the design spec records the baseline result `4/5 premise-first, 1/5 proposal-first` before editing any canonical skill file.

- [ ] **Step 2: Write the positive output recipe**

State what the design presentation is, in order: proposal, rationale, premise-negating alternative, rejection rationale, approval request. Keep the existing semantic tests for generating the alternative, validating rejection reasons, and disposing every enumerated option.

- [ ] **Step 3: Update tracker persistence and migration language**

Replace old three-prefix descriptions with the new four-prefix contract and document that old comments before `2026-08-30T09:32:50Z` remain valid.

- [ ] **Step 4: Run Markdown checks**

Run: `node scripts/check-md-linebreaks.mjs .claude/skills/pfd-ops/references/work-cycle.md .claude/skills/pfd-ops/references/github-issues-backend.md .claude/skills/pfd-ops/references/file-based-tracker-backend.md`

Expected: PASS.

- [ ] **Step 5: Commit the canonical skill contract**

Commit subject: `docs(pfd-ops): make design presentation reader-first`

### Task 4: Regenerate delivery mirrors and verify behavior

**Files:**
- Regenerate: `.agents/skills/pfd-ops/**`
- Regenerate: `plugin/pfdsl/skills/pfd-ops/**`
- Regenerate: `plugin/pfdsl-codex/skills/pfd-ops/**`
- Regenerate: `.claude/skills/pfd-ops/install/**` when generator identity requires it.
- Modify: `.pfdsl/roadmap.pfdsl` status for `reader_first_design_records` from `wip` to `done` after all criteria pass.

**Interfaces:**
- Consumes: canonical skill references and machine contract from Tasks 1-3.
- Produces: byte-consistent Claude/Codex delivery boundaries and a completed roadmap artifact.

- [ ] **Step 1: Regenerate canonical projections**

Run: `make gen-plugin`

Expected: generated mirrors change only where the canonical pfd-ops contract projects them.

- [ ] **Step 2: Run five fresh-context GREEN samples**

Use the same bounded one-line documentation scenario and the updated canonical `work-cycle.md`.

Expected: all five user-facing messages start with the proposal and rationale before the premise-negating alternative.

- [ ] **Step 3: Run repository verification**

Run targeted tests, `pnpm -r test`, `make check-docs`, install/plugin identity checks, and `node scripts/gate-check.mjs --base main --artifact reader_first_design_records --issue 1076`.

Expected: all machine checks pass and the gate recognizes #1076's pre-cutoff legacy record.

- [ ] **Step 4: Mark the roadmap artifact done**

Run: `node packages/cli/dist/cli.js meta set .pfdsl/roadmap.pfdsl reader_first_design_records status done`.

Expected: the artifact is done only after template, gate, mirrors, and five-sample convergence all satisfy its criteria.

- [ ] **Step 5: Review, commit, push, and create the PR**

Commit generated mirrors and the done transition with the canonical source when generator freshness requires the same commit. Push `codex/issue-1076-reader-first-design`, create a PR to `main`, include `Closes #1076`, and reread the persisted PR body exactly.
