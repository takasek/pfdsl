# Retrospective Transformation Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace capability-as-finding feedback and three aggregate maintenance processes with an explicit retrospective execution pipeline, a human decision gate, and 21 independently owned maintenance transformations.

**Architecture:** Existing Git and GitHub workflow artifacts plus session and scheduler records feed a frozen retrospective inventory. Planning produces both a selection record and frozen subject contents, execution produces findings, discussion prepares a human decision trigger, and target-addressed decisions dispatch to 21 maintenance processes. The skill-wiring checker derives each bundled artifact's unique producer from graph edges rather than requiring a producer named `distill_ops`.

**Tech Stack:** PFD DSL 0.0.25, Node.js ESM, `node:test`, repository Make targets and validation scripts.

**Spec:** `docs/superpowers/specs/2026-08-29-retrospective-transformation-model-design.md`

## Global Constraints

- Use t-wada Red-Green-Refactor for production JavaScript changes: run each new checker test before implementation and retain the expected failure output in the task report.
- Keep `.pfdsl/workflow.pfdsl`, `.pfdsl/workflow.md`, and checker changes in separate commits.
- Do not push and do not create a pull request.
- `decide` is the sole producer of `decisions`; a decision records the human authority, target canonical artifact or artifacts, and concrete change instruction.
- The only new external activity artifacts are `retro_request`, `session_records`, and `scheduler_records`; do not introduce `activity_sources`.
- All 21 maintenance processes consume `decisions` as their normal driving input and produce exactly one canonical artifact.
- Feedback inputs are selected by the counterfactual test rather than copied mechanically from the removed aggregate processes.
- Natural-language text follows the repository line-break rules, and user-facing text remains English.

---

### Task 1: Replace the workflow topology

**Files:**
- Modify: `.pfdsl/workflow.pfdsl`

**Interfaces:**
- Consumes: the artifact and process contract in the design spec.
- Produces: canonical graph nodes and edges consumed by the companion and skill-wiring checker tasks.

- [ ] **Step 1: Capture the pre-change graph and verify the three aggregate producers exist**

Run:

```bash
pfdsl --version
pfdsl graph edges .pfdsl/workflow.pfdsl --json > /private/tmp/issue-1031-edges-before.json
pfdsl graph neighbors .pfdsl/workflow.pfdsl distill_ops
pfdsl graph neighbors .pfdsl/workflow.pfdsl distill_local_skills
pfdsl graph neighbors .pfdsl/workflow.pfdsl externalize_bindings
```

Expected: CLI version `0.0.25`; each removed process has output neighbors.

- [ ] **Step 2: Replace the dialogue and retrospective topology**

Add artifact metadata for exactly these new artifacts: `retro_request`, `session_records`, `scheduler_records`, `pre_retro_inventory`, `retro_plan`, `retro_subject_snapshot`, `retro_findings`, and `decision_trigger`. Each description and criteria must encode the distinctions in the design spec, including frozen cutoffs, source coverage, resolved subject contents, finding evidence, human disposition, and target-addressed dispatch.

Replace the relevant graph statements with this exact core:

```pfdsl
user_intent >> discuss -> [decision_trigger, payoff_log, proposals, topics]

[findings, retro_findings, adrs] >>? discuss

decision_trigger >> decide -> decisions

[retro_request, gh_issues, issue_updates, pull_request, integrated_repository, session_records, scheduler_records] >> collect_activity -> pre_retro_inventory

retro_skill >>? collect_activity

[pre_retro_inventory, integrated_repository] >> plan_retro -> [retro_plan, retro_subject_snapshot]

retro_skill >>? plan_retro

[retro_plan, retro_subject_snapshot] >> run_retro -> retro_findings

retro_skill >>? run_retro
```

Remove `retro_skill >>? discuss`; do not add `payoff_log >>? discuss`.

- [ ] **Step 3: Replace the aggregate maintenance processes with the 21 mappings**

Declare each process with `tags: [ knowledge_maintenance ]`, a description naming its actual target and evidence, and criteria naming the target-specific validation command or observable check. Delete `distill_ops`, `distill_local_skills`, and `externalize_bindings` declarations and edges.

```text
maintain_distributed_advisory_hooks -> distributed_advisory_hooks
maintain_ecosystem_skill -> ecosystem_skill
maintain_grill_skill -> grill_skill
maintain_implementer_agent -> implementer_agent
maintain_ops_skill_general -> ops_skill_general
maintain_ops_skill_github_backend -> ops_skill_l3
maintain_pfd_lens_agent -> pfd_lens_agent
maintain_retro_skill -> retro_skill
maintain_review_perspectives -> review_perspectives
maintain_ops_binding -> bindings_pfd_ops
maintain_retro_binding -> bindings_pfd_retro
maintain_delegation_guard -> delegation_guard
maintain_main_branch_guard -> main_branch_guard
maintain_pre_artifact_advisory -> pre_artifact_advisory
maintain_workflow_companion -> workflow_md
maintain_distribution_review_perspectives -> distribution_review_perspectives
maintain_distribution_review_skill -> distribution_review_skill
maintain_prose_mechanization_audit_skill -> prose_mechanization_audit_skill
maintain_retro_pattern_sweep_skill -> retro_pattern_sweep_skill
maintain_spec_stress_skill -> spec_stress_skill
maintain_vscode_ext_debug_skill -> vscode_ext_debug_skill
```

Give all 21 processes `decisions` as a normal input. Apply only these evidence families, with each edge retained only where the process description states the concrete consumption:

```pfdsl
distribution_review_record >>? maintain_distributed_advisory_hooks
distribution_review_record >>? maintain_ecosystem_skill
distribution_review_record >>? maintain_grill_skill
distribution_review_record >>? maintain_implementer_agent
distribution_review_record >>? maintain_ops_skill_general
distribution_review_record >>? maintain_ops_skill_github_backend
distribution_review_record >>? maintain_pfd_lens_agent
distribution_review_record >>? maintain_retro_skill
distribution_review_record >>? maintain_review_perspectives
distribution_review_record >>? maintain_distribution_review_perspectives
distribution_review_record >>? maintain_distribution_review_skill

prose_mechanization_sweep_record >>? maintain_ops_binding
prose_mechanization_sweep_record >>? maintain_retro_binding
prose_mechanization_sweep_record >>? maintain_delegation_guard
prose_mechanization_sweep_record >>? maintain_main_branch_guard
prose_mechanization_sweep_record >>? maintain_pre_artifact_advisory
prose_mechanization_sweep_record >>? maintain_workflow_companion

retro_pattern_sweep_record >>? maintain_retro_binding
```

Do not connect `adrs`, `payoff_log`, or `retro_findings` directly to the 21 processes: `decisions` carries the approved target and concrete instruction, while those artifacts remain upstream evidence for human disposition. Do not duplicate any normal and feedback edge pair.

- [ ] **Step 4: Update classifications and intrinsic descriptions**

Add a `knowledge_maintenance` tag declaration whose description classifies independently owned canonical-maintenance transformations. Rewrite `distilled_skill` and `distilled_doc` descriptions so they classify artifact form without naming a producer. Remove the obsolete `examples` description reference to `distill_ops`.

- [ ] **Step 5: Format and validate the graph**

Run:

```bash
pfdsl fmt .pfdsl/workflow.pfdsl --write
pfdsl check .pfdsl/workflow.pfdsl --strict --no-color
pfdsl meta check-links .pfdsl/workflow.pfdsl
pfdsl graph orphans .pfdsl/workflow.pfdsl
pfdsl graph io .pfdsl/workflow.pfdsl
pfdsl graph stats .pfdsl/workflow.pfdsl
pfdsl graph edges .pfdsl/workflow.pfdsl --json > /private/tmp/issue-1031-edges-after-workflow.json
git diff --check
```

Expected: check and link validation exit 0; removed process IDs do not appear; `decide` is the sole producer of `decisions`; the eight new artifacts and four new processes appear; no unintended orphan appears.

- [ ] **Step 6: Commit the workflow structure**

Parent agent stages and commits with:

```text
refactor(pfd): split retrospective maintenance flow
```

---

### Task 2: Migrate the workflow companion

**Files:**
- Modify: `.pfdsl/workflow.md`

**Interfaces:**
- Consumes: process IDs, tag, and producer relationships from Task 1.
- Produces: companion prose that no longer instructs readers to query removed aggregate producers.

- [ ] **Step 1: Enumerate stale names before editing**

Run:

```bash
rg -n "distill_ops|distill_local_skills|externalize_bindings" .pfdsl/workflow.md
```

Expected: the knowledge-routing, skill-wiring, terminal-artifact, agent-inventory, and hook-inventory sections contain stale references.

- [ ] **Step 2: Rewrite routing and inventory instructions**

Replace producer-name routing with these contracts:

```text
- Query `knowledge_maintenance` processes when listing the independently maintained family.
- Query an artifact's producer when locating the maintenance process for one canonical asset.
- Treat unique workflow production and runtime `gen_plugin` reachability as separate checker requirements.
- Describe local skills, distributed skills, bindings, companions, and guards by target artifact classification, not by a removed aggregate process.
```

Update every command example that names a removed process to an artifact-driven producer query supported by the repository CLI, or to a `knowledge_maintenance` tag query where the whole family is intended.

- [ ] **Step 3: Verify companion synchronization**

Run:

```bash
rg -n "distill_ops|distill_local_skills|externalize_bindings" .pfdsl/workflow.md
node scripts/check-md-linebreaks.mjs .pfdsl/workflow.md
node scripts/check-companion-bindings.mjs
git diff --check
```

Expected: the search returns no matches; both checks exit 0.

- [ ] **Step 4: Commit the companion migration**

Parent agent stages and commits with:

```text
docs(pfd): update maintenance routing companion
```

---

### Task 3: Make skill wiring producer-name independent with TDD

**Files:**
- Modify: `scripts/check-skill-wiring.mjs`
- Modify: `scripts/lib/skill-wiring-check.mjs`
- Modify: `scripts/lib/skill-wiring-check.test.mjs`
- Modify: `scripts/lib/skill-wiring-check-steps.mjs`
- Modify: `scripts/lib/skill-wiring-check-steps.test.mjs`

**Interfaces:**
- Consumes: parsed workflow `output` edges and runtime-pipeline primary reachability.
- Produces: one finding for zero producers, one finding naming all producers when more than one exists, and no producer finding for exactly one producer regardless of its process ID.

- [ ] **Step 1: Add failing unit tests for missing, duplicate, and renamed producers**

In `scripts/lib/skill-wiring-check.test.mjs`, replace the `distill_ops`-specific fixture assumption and add these behavioral cases around `findUnwiredSkills`:

```js
it("reports a bundled workflow artifact with no producer", () => {
	const findings = findUnwiredSkills({
		workflowArtifacts: ARTIFACTS,
		pipelineArtifacts: {},
		workflowEdges: WORKFLOW_EDGES.filter(
			(edge) => !(edge.kind === "output" && edge.artifact === "retro_skill"),
		),
		pipelineEdges: PIPELINE_EDGES,
		mirrors: MIRRORS,
	});
	assert.deepEqual(findings.find(({ id }) => id === "retro_skill")?.producers, []);
});

it("reports every producer when a bundled workflow artifact has duplicates", () => {
	const findings = findUnwiredSkills({
		workflowArtifacts: ARTIFACTS,
		pipelineArtifacts: {},
		workflowEdges: [
			...WORKFLOW_EDGES,
			{ kind: "output", artifact: "retro_skill", process: "other_retro_maintainer" },
		],
		pipelineEdges: PIPELINE_EDGES,
		mirrors: MIRRORS,
	});
	assert.deepEqual(
		findings.find(({ id }) => id === "retro_skill")?.producers.sort(),
		["maintain_retro_skill", "other_retro_maintainer"],
	);
});

it("accepts a unique producer with an arbitrary process name", () => {
	const findings = findUnwiredSkills({
		workflowArtifacts: ARTIFACTS,
		pipelineArtifacts: {},
		workflowEdges: WORKFLOW_EDGES.map((edge) =>
			edge.kind === "output" && edge.artifact === "retro_skill"
				? { ...edge, process: "renamed_retro_maintainer" }
				: edge,
		),
		pipelineEdges: PIPELINE_EDGES,
		mirrors: MIRRORS,
	});
	assert.equal(findings.some(({ id }) => id === "retro_skill"), false);
});
```

Change the fixture producer for `retro_skill` to `maintain_retro_skill` before running these cases.

- [ ] **Step 2: Run the focused tests and record RED**

Run:

```bash
node --test scripts/lib/skill-wiring-check.test.mjs
```

Expected: the new missing/duplicate producer assertions fail because current code only recognizes `distill_ops` membership and does not return `producers`.

- [ ] **Step 3: Implement unique-producer discovery**

Add this helper to `scripts/lib/skill-wiring-check.mjs` and use it for workflow-declared bundled artifacts:

```js
export function artifactProducers(edges, artifact) {
	return edges
		.filter((edge) => edge.kind === "output" && edge.artifact === artifact)
		.map((edge) => edge.process)
		.sort();
}
```

For a workflow-declared bundled artifact, store the returned list as `producers`. Add `"workflow producer"` to `missing` when the list is empty and `"unique workflow producer"` when its length exceeds one. Exactly one producer satisfies the workflow side regardless of its name. Keep pipeline-only artifacts exempt from workflow production and keep `artifactReachesProcess(..., "gen_plugin")` unchanged.

- [ ] **Step 4: Run unit tests and record GREEN**

Run:

```bash
node --test scripts/lib/skill-wiring-check.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Add failing orchestration tests for actionable messages**

In `scripts/lib/skill-wiring-check-steps.test.mjs`, add one missing-producer fixture and one duplicate-producer fixture. Assert that missing output instructs the reader to add one producer edge without naming `distill_ops`, duplicate output names both conflicting producers, and a uniquely renamed producer returns `check-skill-wiring: OK`.

- [ ] **Step 6: Run orchestration tests and record RED**

Run:

```bash
node --test scripts/lib/skill-wiring-check-steps.test.mjs
```

Expected: new message assertions fail because the formatter still emits `distill_ops -> [...]` guidance and cannot describe duplicates.

- [ ] **Step 7: Update orchestration and entrypoint prose**

In `scripts/lib/skill-wiring-check-steps.mjs`, format the producer findings as:

```text
'<artifact>' is bundled (<location>) but has no workflow producer
'<artifact>' is bundled (<location>) but has multiple workflow producers: <sorted process IDs>
Add exactly one output edge for it in .pfdsl/workflow.pfdsl.
```

Retain the existing `does not reach gen_plugin` message for delivery failures. Rewrite comments and the header in `scripts/check-skill-wiring.mjs` to describe unique workflow production rather than `distill_ops`.

- [ ] **Step 8: Run both focused suites and the live checker**

Run:

```bash
node --test scripts/lib/skill-wiring-check.test.mjs scripts/lib/skill-wiring-check-steps.test.mjs
node scripts/check-skill-wiring.mjs
git diff --check
```

Expected: all tests pass and the live checker prints `check-skill-wiring: OK`.

- [ ] **Step 9: Commit checker and tests together**

Parent agent stages and commits with:

```text
refactor(check): derive unique skill producers
```

---

### Task 4: Verify the whole change and generate the PR input-edge matrix

**Files:**
- Create outside Git: `/private/tmp/issue-1031-input-edge-matrix.md`
- Verify: `.pfdsl/workflow.pfdsl`
- Verify: `.pfdsl/workflow.md`
- Verify: checker files from Task 3

**Interfaces:**
- Consumes: canonical graph edges after Tasks 1-3.
- Produces: fresh verification evidence and PR-body-ready Markdown whose present edge cells exactly match the graph JSON.

- [ ] **Step 1: Run repository verification**

Run through the repository wrappers where available:

```bash
pfdsl check .pfdsl/workflow.pfdsl --strict --no-color
pfdsl meta check-links .pfdsl/workflow.pfdsl
node --test scripts/lib/skill-wiring-check.test.mjs scripts/lib/skill-wiring-check-steps.test.mjs
make check-docs
make test
make build
git diff --check
```

Expected: every command exits 0; tests report zero failures.

- [ ] **Step 2: Export the canonical edge set**

Run:

```bash
pfdsl graph edges .pfdsl/workflow.pfdsl --json > /private/tmp/issue-1031-edges-final.json
```

Expected: valid JSON containing every graph edge with its kind.

- [ ] **Step 3: Generate the 26-process input-edge matrix**

Generate `/private/tmp/issue-1031-input-edge-matrix.md` with one row per actual or explicitly absent candidate input for these processes:

```text
collect_activity, plan_retro, run_retro, discuss, decide,
maintain_distributed_advisory_hooks, maintain_ecosystem_skill, maintain_grill_skill,
maintain_implementer_agent, maintain_ops_skill_general, maintain_ops_skill_github_backend,
maintain_pfd_lens_agent, maintain_retro_skill, maintain_review_perspectives,
maintain_ops_binding, maintain_retro_binding, maintain_delegation_guard,
maintain_main_branch_guard, maintain_pre_artifact_advisory, maintain_workflow_companion,
maintain_distribution_review_perspectives, maintain_distribution_review_skill,
maintain_prose_mechanization_audit_skill, maintain_retro_pattern_sweep_skill,
maintain_spec_stress_skill, maintain_vscode_ext_debug_skill
```

Use columns `Process | Candidate input | Present | Kind | Counterfactual reason`. Present rows must be derived from `/private/tmp/issue-1031-edges-final.json`; absent rows must cover `adrs`, `payoff_log`, `retro_findings`, `distribution_review_record`, `prose_mechanization_sweep_record`, and `retro_pattern_sweep_record` wherever the design considered but rejected them.

- [ ] **Step 4: Compare matrix cells with graph JSON**

Run a read-only Node comparison that parses the JSON, parses every matrix row marked `yes`, and compares the sorted `artifact/process/kind` triples for the 26 target processes. It must also reject an actual input edge for a target process that has no matrix row.

Expected: exact set equality, at least one feedback evidence edge, zero matrix-only edges, zero graph-only edges, and zero kind mismatches.

- [ ] **Step 5: Confirm commit and publication boundaries**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
```

Expected: no uncommitted files; separate commits exist for design, workflow structure, companion prose, and checker plus tests. Stop without push and without PR creation.

---

### Task 5: Correct the retrospective checkpoint visibility boundary

**Files:**
- Modify: `docs/superpowers/specs/2026-08-29-retrospective-transformation-model-design.md`
- Modify: `.claude/skills/pfd-retro/SKILL.md`
- Regenerate: distributed pfd-retro skill mirrors

**Interfaces:**
- Consumes: the observed failure where the current contract attempted to copy an internal session identifier into a public PR before read-only subagent handoff.
- Produces: a checkpoint contract that persists only evidence a recipient would otherwise lose, preserves the evidence visibility boundary, and requires exact human approval before any public checkpoint write.

- [ ] **Step 1: Record the failing pressure scenario**

Use the actual pfd-retro invocation against PR #1036 as RED evidence: a read-only A/B handoff must not require publishing the session inventory, while a cross-session handoff that would lose transient evidence must either use a visibility-compatible checkpoint or stop.

- [ ] **Step 2: Revise the canonical execution contract and regenerate mirrors**

The contract must distinguish same-task compaction, repository-only read-only delegation, and evidence-bearing handoff. It must forbid public disclosure of internal identifiers and require approval of exact content and destination before an issue or PR write.

- [ ] **Step 3: Re-run the pressure scenario and repository verification**

Dispatch a fresh read-only pfd-lens agent with only the frozen repository snapshot. GREEN means the delegation proceeds without a public checkpoint, the agent receives no transient session inventory, and its file:line findings can be merged with the main-thread C/D audit. Then regenerate mirrors and run documentation, strict PFD, and full repository checks.
