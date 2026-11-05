# Retrospective transformation model design

## Purpose

`workflow.pfdsl` used the retrospective skill artifact itself as feedback to maintenance processes, conflating an audit capability with the findings produced by one execution. The same diagram grouped independently maintained outputs under processes that hid which decision changes which artifact.

This design models the complete path from observable activity through retrospective planning and human decisions to independently maintained knowledge artifacts. It permits manual and automated audit triggers while retaining human authority over every repository change.

Its maintenance and retrospective-collection sections were revised by #1046 after the first implementation: the per-asset process split and the seven required activity sources both stated in the graph something that is not true of a single run. Sections below carry the current model; the superseded shapes are described where the reasoning needs them.

## Design principles

1. Capabilities, execution subjects, execution results, and decisions are different artifact types.
2. Trigger classes are non-exclusive. One activity event may participate in multiple retrospective or decision triggers.
3. Completeness is relative to an explicit time window and source set. Missing required sources stop the flow rather than producing an empty-success result.
4. Automated collection and auditing may produce findings, but only a human-confirmed decision may drive repository maintenance.
5. Maintenance processes are split where the revision and validation procedure differs, not once per canonical output. A per-output split whose processes all take the same single normal input states the same transformation repeatedly and leaves target routing outside the graph. Shared generation and delivery commands remain downstream concerns and are not evidence of a shared producer.
6. Transient audit artifacts do not become an ever-growing repository corpus. A checkpoint is required only when a consumer would otherwise lose required transient evidence, and its destination must preserve the evidence's visibility boundary.

## Retrospective collection and execution

The retrospective side combines existing workflow artifacts with two external execution inputs:

- `retro_request` instantiates the exact required source set and time cutoff for one run according to the selection and validation rules in `retro_skill`.
- `retro_evidence_snapshot` is the run-scoped envelope of the evidence actually retrieved for that request, frozen at its cutoff together with its provenance. Its candidate source classes are the GitHub issue, issue-update and pull-request records, the integrated repository, session records, and scheduler records, but which of them appear varies per run.

The audit layers, source-set selection and validation rules, and failure behavior remain normative rules of `retro_skill`. They are not copied into a second policy artifact. `retro_request` and `retro_evidence_snapshot` are execution-time inputs rather than repository-maintained capabilities.

An earlier revision made all seven source artifacts normal inputs of `collect_activity`. That made sources required which a given run never selects, so a GitHub-only run and a session-only run could not both be read from the same diagram. Feedback edges are not the remedy: specification §9.1 states that `>>` does not guarantee `A` exists on every execution, so "`A` is not produced every time" is not a reason to avoid it, and §15.3 limits `>>?` to re-entry, improvement, and auxiliary inputs — a selected source is a primary input of that run, not an auxiliary one. The single per-run envelope keeps the selected evidence a normal input while leaving retrieval detail to runtime. `session_records` and `scheduler_records` disappear as separate artifacts because their content is carried by the envelope. No aggregate `activity_sources` artifact is introduced: the envelope is one run's frozen retrieval result, not a second permanent identity for the GitHub and Git artifacts.

The flow is:

```pfdsl
[retro_request, retro_evidence_snapshot] >> collect_activity -> pre_retro_inventory

retro_skill >>? collect_activity

[pre_retro_inventory, integrated_repository] >> plan_retro -> [retro_plan, retro_subject_snapshot]

retro_skill >>? plan_retro

[retro_plan, retro_subject_snapshot] >> run_retro -> retro_findings

retro_skill >>? run_retro
```

`pre_retro_inventory` is frozen at the `retro_request` cutoff. It records each source query, cutoff, retrieval result, coverage status, and stable event identifiers. It does not record audit or decision dispositions. If a required source is unavailable, the artifact remains incomplete and neither `plan_retro` nor an empty-findings conclusion is permitted.

`retro_plan` records, for every event in the frozen inventory, whether the event participates in this retrospective and why. Classification is non-exclusive. `retro_subject_snapshot` contains the resolved contents of the concrete PFDs, session evidence, and knowledge artifacts selected by that plan, frozen at the same cutoff; it is not merely a list of references. `plan_retro` produces both artifacts because classification determines the selected subjects and the repository has no independent resume or consumer boundary between classification and subject resolution.

The repository contents reach `plan_retro` through `integrated_repository` rather than one edge per canonical artifact because the retrospective subject set is selected anew by each `retro_plan` and may span the whole repository. The existing sweep processes correctly enumerate their fixed, bounded subject sets directly; applying that pattern here would freeze a dynamic audit boundary into the graph and require an edge migration whenever a new canonical artifact becomes eligible for retrospective inspection.

`retro_skill` remains the audit capability. Its edges into collection, planning, and execution are feedback because ADR-0011 requires a capability artifact used upstream of its own maintenance chain to be represented as the previous-generation snapshot. `retro_findings` is the result of applying that capability to one resolved plan and its frozen subject contents. Each finding carries the run identifier and the evidence needed by later human judgment. The old feedback edges from `retro_skill` to discussion and maintenance processes are removed.

## Decision collection and human gate

The existing `discuss` process remains the entry point for user-driven dialogue. Its `decisions` output is replaced with `decision_trigger`; its `payoff_log`, `proposals`, and `topics` outputs remain unchanged. A separate `decide` process performs the human disposition and is the sole producer of `decisions`:

```pfdsl
user_intent >> discuss -> [decision_trigger, payoff_log, proposals, topics]

[findings, retro_findings, adrs] >>? discuss

decision_trigger >> decide -> decisions
```

`decision_trigger` records the alternatives that require human judgment and their evidence references. It does not decide their disposition. `decisions` is the sole artifact that records adoption, rejection, or deferral, together with the human decision maker, the target canonical artifact or artifacts, and a sufficiently concrete change instruction for downstream maintenance. Its fan-out to the maintenance processes is therefore dispatch by named target rather than one untyped decision corpus driving every output.

`retro_findings` is downstream of `discuss` through the existing issue, pull-request, and integrated-repository path that supplies retrospective evidence. Returning it to `discuss` is therefore backward feedback under specification section 15.3; a normal edge would form the V010 cycle that feedback exists to represent. The counterfactual normal driver remains `user_intent`: `discuss` can produce a `decision_trigger` without a retrospective run, and retrospective evidence supplements rather than replaces that driver. The normal driving path is `user_intent >> discuss -> decision_trigger >> decide -> decisions`. This means an automated retrospective may produce findings, but repository maintenance begins only after a human expresses the intent to disposition them.

`discuss` and `decide` remain separate because ownership changes at their boundary. Agent-assisted dialogue organizes alternatives and evidence into `decision_trigger`; the human decision maker then owns the adoption, rejection, or deferral recorded in `decisions`. This is the quality guide's handoff point where responsibility changes, even when the two processes occur consecutively in one conversation.

The separate decision activity inventory and collector are removed from the design. The repository's actual decision path is dialogue or asynchronous issue and PR review, both represented by `discuss` followed by `decide`; there is no independent decision-event collection operation to model.

## Persistence and restart contract

Inventory and plan artifacts may remain structured session outputs while every consumer that needs them has guaranteed access to the same task record. Compaction does not require a checkpoint when the host preserves that record. A read-only subagent that audits a frozen repository snapshot without consuming transient session evidence receives the public commit or file snapshot it needs and does not trigger persistence of the session inventory. No per-run repository file is added.

Before a handoff whose recipient lacks guaranteed access to required transient evidence, the minimum checkpoint is persisted to a destination visible only to its intended consumers. The checkpoint includes the cutoff, source coverage, public or destination-safe event identifiers, and unresolved findings. Internal session identifiers, tool metadata, and private evidence are never copied into a public issue or PR. A public issue or PR may be used only after the exact content and destination have been shown to the human and explicitly approved; approval of the retrospective itself is not approval of that external write. If no visibility-compatible destination exists or approval is withheld, the handoff stops and the audit is completed in the same task and session instead. If the task record is lost before a required checkpoint, the old run is abandoned. A replacement run collects all sources again at a new cutoff and does not claim identity with the abandoned run. Human decision checkpoints use the existing `decision_trigger` and `decisions` records in the issue or PR rather than a second inventory format.

Once human decisions have been applied to durable repository artifacts, intermediate inventories need not be retained permanently.

## Knowledge maintenance processes

The broad `distill_ops`, `distill_local_skills`, and `externalize_bindings` processes are removed. An earlier revision of this design replaced them with 21 per-asset maintenance processes, one for each canonical output. That split did not hold: every one of the 21 had `decisions` as its only normal input, so no process had a statically visible target-specific driver, and the routing of a decision to its target existed only as prose telling each process to ignore decisions aimed elsewhere. A graph whose 21 causal edges are all identical does not model dispatch; it models one transformation drawn 21 times, and its node list doubles as a copy of the plugin's distribution membership.

The maintenance side is therefore modeled by the boundary that actually exists: a human-authorized change instruction revises a canonical asset. Three processes carry it, split where the revision and validation procedure genuinely differs. The table below states the intended split; the current membership of each process is read from `workflow.pfdsl`, which is its primary source.

| Process | Outputs |
|---|---|
| `maintain_distributed_prompt_assets` | `distributed_advisory_hooks`, `ecosystem_skill`, `grill_skill`, `implementer_agent`, `ops_skill_general`, `ops_skill_l3`, `pfd_lens_agent`, `retro_skill`, `review_perspectives` |
| `maintain_repo_bindings` | `bindings_pfd_ops`, `bindings_pfd_retro`, `delegation_guard`, `main_branch_guard`, `pre_artifact_advisory`, `workflow_md` |
| `maintain_repo_local_capabilities` | `distribution_review_perspectives`, `distribution_review_skill`, `prose_mechanization_audit_skill`, `retro_pattern_sweep_skill`, `spec_stress_skill`, `vscode_ext_debug_skill` |

Collapsing further, into a single `maintain_knowledge_asset`, is rejected by the quality guide's universal-process test: splitting its outputs into the guard group and the distributed group yields groups producible from a proper subset of the inputs, which is the signature of a false bundle. Splitting further, back toward one process per asset, is rejected by the same test read the other way — no candidate split produces a group whose normal inputs are a proper subset, because every group's normal input is exactly `decisions`.

The test is applied to normal inputs only, and that restriction is load-bearing rather than incidental. Every output carries its own revision baseline as feedback, so counting feedback edges makes any group of two or more outputs splittable by construction, and the test would mandate exactly the per-asset split whose failure is recorded above. A revision baseline is not a driver of the transformation; it is the artifact being edited. Reading the test over drivers is what keeps it answering the question it exists to answer — whether the process bundles two transformations — rather than restating that the outputs are distinct artifacts, which is already known.

The distribution axis in the first group's name is a consequence of its maintenance procedure, not membership leaking back into the workflow. What that group shares is that its revision is evidenced by `distribution_review_record` — a record that exists only because the asset is read by an adopting repository. If an asset stops being bundled, its available evidence changes with it, and moving it to another producer is the correct consequence rather than a bookkeeping cost. What stays outside this diagram is the list itself: no node or edge here answers which files `make gen-plugin` copies, and adding an asset to the bundle does not require an edge migration until its maintenance procedure actually changes.

The 21 artifact nodes are retained individually. Node granularity follows independent canonical location, independent revision and validation, and ownership boundary; the presence or absence of an in-graph consumer is corroborating evidence rather than the criterion, since consumers are added and removed without the asset's ownership changing. What moves out of the workflow is not the nodes but the claim they were implicitly making: which assets ship in the plugin is stated by the gen-plugin manifest and `pipeline_pfdsl`, and the workflow's nodes carry maintenance responsibility only.

Each of the three processes has `decisions` as its normal driving input. Each output is also fed back into its own process: holding the decision and evidence fixed, changing the current text, rule, guard, or procedure changes the revised output, because maintenance edits the existing asset rather than recreating it from the decision alone. Feedback expresses same-artifact revision without adding a primary cycle, matching the existing `spec >>? maintain_spec` pattern. Target-specific evidence enters as feedback where the target's real maintenance procedure reads it: `distribution_review_record` into the distributed and repo-local capability processes, `prose_mechanization_sweep_record` and `retro_pattern_sweep_record` into the bindings process, and `retro_findings` into all three. `decisions` remains the sole normal input and the finding supplies the target-specific evidence used to realize the authorized change; the required routes `retro_findings` → `ops_skill_l3` and `retro_findings` → `bindings_pfd_retro` hold through their respective processes with the correctly typed retrospective result rather than the old `retro_skill` capability snapshot.

The same revision-baseline counterfactual applies outside the `knowledge_maintenance` family wherever a process edits an existing durable artifact. It therefore also covers both outputs of `maintain_template`, `feature_samples` in `maintain_samples`, `workflow_pfdsl` in `map_workflow`, both pipeline documents in `map_transform_boundaries`, `readme` in `update_readme`, `adrs` in `draft_adrs`, and both roadmap outputs in `map_deps`; `roadmap_pfdsl` already had this feedback edge, while `roadmap_md` completes its sibling baseline. `write_article` is excluded because `article` is a one-off deliverable without an in-diagram revision cycle, not because it is terminal. `gh_issues >>? file_issues` would duplicate the external issue-state feedback already carried by `issue_updates >>? file_issues`. `integrated_repository >>? merge_pr` would duplicate repository state already returned through `integrated_repository >> project_toolchain -> toolchain >>? develop` around the merge and development cycle.

The three processes carry the `knowledge_maintenance` process tag, following ADR-0019's rule that structurally related process families are grouped by tags rather than a false shared process. The existing `distilled_skill` and `distilled_doc` artifact tags remain as intrinsic artifact classifications and do not name producer processes.

Shared `make gen-plugin` execution remains represented by the pipeline diagram. It assembles canonical inputs into distributed mirrors and does not merge their maintenance responsibilities.

## Companion and checker migration

The process split changes existing process-name contracts and therefore must update them in the same pull request:

- `.pfdsl/workflow.md` must name the current maintenance process IDs in its knowledge-routing rules and agent/hook inventory instructions, and must state that distribution membership is owned by the gen-plugin manifest and `pipeline_pfdsl` rather than by the workflow's artifact nodes.
- `scripts/check-skill-wiring.mjs` must not treat any particular producer process name as production evidence. It must instead verify that every required distributed skill or agent artifact has exactly one producer in `workflow.pfdsl` and retains the required pipeline consumption edge.
- Tests must distinguish a missing producer, duplicate producers, and a valid producer whose name is not hard-coded by the checker.
- Prose elsewhere in the repository that names a removed process as an artifact's producer must be repointed at the current producer or rewritten to be producer-agnostic.
- The `distilled_skill` and `distilled_doc` tag descriptions must stop naming the removed processes, and process-family queries must use `knowledge_maintenance` rather than a former aggregate producer.
- The old process declarations and edges must be removed completely rather than retained as checker compatibility aliases.

## Validation

The implementation is complete only when all of the following hold:

1. `pfdsl check .pfdsl/workflow.pfdsl --strict --no-color` passes.
2. The removed process ID set is exactly `distill_ops`, `distill_local_skills`, `externalize_bindings`, and the 21 per-asset `maintain_*` IDs of the earlier revision; the maintenance process ID set is exactly `maintain_distributed_prompt_assets`, `maintain_repo_bindings`, and `maintain_repo_local_capabilities`, each carrying the `knowledge_maintenance` tag, and their combined outputs are exactly the 21 canonical artifacts listed above with no artifact produced twice.
3. The retrospective and decision artifacts are exactly `retro_request`, `retro_evidence_snapshot`, `pre_retro_inventory`, `retro_plan`, `retro_subject_snapshot`, `retro_findings`, and `decision_trigger`; the execution processes are exactly `collect_activity`, `plan_retro`, `run_retro`, and `decide`. No `session_records`, `scheduler_records`, or aggregate `activity_sources` artifact exists.
4. The retrospective normal edges match the flow declared above: `retro_request` and `retro_evidence_snapshot` into `collect_activity`, `integrated_repository` and `pre_retro_inventory` into `plan_retro`, and both `retro_plan` and `retro_subject_snapshot` into `run_retro`. No GitHub or Git source artifact is a direct input of `collect_activity` in either edge kind. A run whose request selects only GitHub sources and a run whose request selects only session evidence are both readable from these edges without a diagram change. Changing a selected canonical artifact in `integrated_repository` must be able to change `retro_subject_snapshot` and `retro_findings` without changing `retro_plan` references.
5. `user_intent >> discuss`, `discuss -> decision_trigger`, and `decision_trigger >> decide -> decisions` are normal edges, and `decisions` is the only normal input of each maintenance process. `retro_findings >>? discuss`, `retro_findings` into each of the three maintenance processes, each canonical output back into the process that produces it, the additional revision baselines enumerated above, the target-specific sweep and review records into the processes whose procedure reads them, and the three `retro_skill` edges into collection, planning, and execution are feedback edges. No second producer of `decisions` exists. The `decide` description and criteria name the human decision maker as the sole disposition authority, and the `decisions` criteria require both that human authority and the target canonical artifact or artifacts to be recorded.
6. Paths exist from `decisions` and `retro_findings` to both `ops_skill_l3` and `bindings_pfd_retro`; the `retro_findings` paths use feedback edges into the maintenance processes that produce those artifacts.
7. No old feedback path treats `retro_skill` as a finding or decision input.
8. Every durable artifact identified as a revision baseline above has a producer and exactly one feedback edge into that producer, including every output of a multi-output process; V001 independently rejects duplicate producers.
9. Checker tests fail for missing and duplicate producers and pass for renamed valid producers, and no test asserts a specific producer process name as evidence of production.
10. Companion prose, tag descriptions, and graph structure name the same responsibilities, and no prose in `.pfdsl/` or `docs/` names a removed process as a current producer.
11. `graph orphans`, `graph io`, `graph edges`, and `graph stats` match the declared node and edge migration above, and `make check-docs` plus the relevant script tests pass.
12. The pull request body contains an input-edge matrix covering the three maintenance processes, the retrospective and decision processes, every additional revision process enumerated above, and the three explicitly excluded candidates. For every candidate input named by this design, the matrix records whether an edge is present or absent, records the edge kind when present, and gives a one-line counterfactual reason tied to the process's actual procedure. Each `retro_findings` row for a maintenance process and each required current-output baseline row must be `yes` / `feedback`; the former explains how changing the finding changes the authorized edit while the decision stays fixed, and the latter explains how changing the existing asset changes the revised output while other inputs stay fixed. The matrix records `article`, `gh_issues`, and `integrated_repository` as absent candidates for `write_article`, `file_issues`, and `merge_pr` respectively, with the exclusion reasons above. The matrix cells must match the canonical edge set returned by `pfdsl graph edges .pfdsl/workflow.pfdsl --json`; any unlisted candidate edge, matrix-only edge, graph-only edge, or edge-kind mismatch fails validation. Review of the matched matrix must reject mechanical replication of aggregate inputs, omission of every evidence edge or revision baseline, failure to inspect every output of a multi-output process, and any process whose declared inputs are insufficient to produce its output.

## Scope boundaries

This change models and validates the workflow. It does not implement a scheduler, a new permanent activity ledger, or automatic repository mutation. Existing session, Git, GitHub, scheduler, issue, and PR records remain authoritative. Pipeline generation and delivery semantics do not change, so `pipeline.pfdsl` changes only if implementation reveals an actual delivery-boundary change.
