# Retrospective transformation model design

## Purpose

`workflow.pfdsl` currently uses the retrospective skill artifact itself as feedback to maintenance processes. This conflates an audit capability with the findings produced by one execution. The same diagram also groups 21 independently maintained outputs under three broad processes, hiding which decision changes which artifact.

This design models the complete path from observable activity through retrospective planning and human decisions to independently maintained knowledge artifacts. It permits manual and automated audit triggers while retaining human authority over every repository change.

## Design principles

1. Capabilities, execution subjects, execution results, and decisions are different artifact types.
2. Trigger classes are non-exclusive. One activity event may participate in multiple retrospective or decision triggers.
3. Completeness is relative to an explicit time window and source set. Missing required sources stop the flow rather than producing an empty-success result.
4. Automated collection and auditing may produce findings, but only a human-confirmed decision may drive repository maintenance.
5. Each maintenance process has one independently changeable canonical output. Shared generation and verification commands are downstream delivery concerns, not evidence that canonical artifacts share a producer.
6. Transient audit artifacts do not become an ever-growing repository corpus. A cross-session handoff uses an existing issue or PR as a checkpoint.

## Retrospective collection and execution

The retrospective side uses two execution inputs:

- `retro_request` instantiates the exact required source set and time cutoff for one run according to the selection and validation rules in `retro_skill`.
- `activity_sources` provides the reachable snapshot or stable handles for the source set instantiated by the request.

The audit layers, source-set selection and validation rules, and failure behavior remain normative rules of `retro_skill`. They are not copied into a second policy artifact. `retro_request` and `activity_sources` are execution-time inputs rather than repository-maintained capabilities.

The flow is:

```pfdsl
[retro_request, activity_sources] >> collect_activity -> pre_retro_inventory

retro_skill >>? collect_activity

pre_retro_inventory >> plan_retro -> retro_plan

retro_skill >>? plan_retro

retro_plan >> run_retro -> retro_findings

retro_skill >>? run_retro
```

`pre_retro_inventory` is frozen at the `retro_request` cutoff. It records each source query, cutoff, retrieval result, coverage status, and stable event identifiers. It does not record audit or decision dispositions. If a required source is unavailable, the artifact remains incomplete and neither `plan_retro` nor an empty-findings conclusion is permitted.

`retro_plan` records, for every event in the frozen inventory, whether the event participates in this retrospective and why. Classification is non-exclusive. The plan also resolves the concrete PFDs, session evidence, and knowledge artifacts to inspect and records that each subject is reachable. Trigger classification and subject resolution are a single process because the repository has no independent resume or consumer boundary between those operations.

`retro_skill` remains the audit capability. Its edges into collection, planning, and execution are feedback because ADR-0011 requires a capability artifact used upstream of its own maintenance chain to be represented as the previous-generation snapshot. `retro_findings` is the result of applying that capability to one resolved plan. Each finding carries the run identifier and the evidence needed by later human judgment. The old feedback edges from `retro_skill` to discussion and maintenance processes are removed.

## Decision collection and human gate

The existing `discuss` process remains the entry point for user-driven dialogue. Its `decisions` output is replaced with `decision_trigger`; its `payoff_log`, `proposals`, and `topics` outputs remain unchanged. A separate `decide` process performs the human disposition and is the sole producer of `decisions`:

```pfdsl
user_intent >> discuss -> [decision_trigger, payoff_log, proposals, topics]

[findings, retro_findings, adrs] >>? discuss

decision_trigger >> decide -> decisions
```

`decision_trigger` records the alternatives that require human judgment and their evidence references. It does not decide their disposition. `decisions` is the sole artifact that records adoption, rejection, or deferral, together with the human decision maker, the target canonical artifact or artifacts, and a sufficiently concrete change instruction for downstream maintenance. Its fan-out to the maintenance processes is therefore dispatch by named target rather than one untyped decision corpus driving every output.

`retro_findings` is a nonconnected auxiliary evidence input to `discuss`, so it uses feedback under specification section 15.3 rather than being presented as downstream of `discuss`. The counterfactual normal driver is `user_intent`: `discuss` can produce a `decision_trigger` without a retrospective run, while making `retro_findings` normal would falsely make retrospective evidence a required gate for every discussion. The normal driving path is `user_intent >> discuss -> decision_trigger >> decide -> decisions`. This means an automated retrospective may produce findings, but repository maintenance begins only after a human expresses the intent to disposition them.

`discuss` and `decide` remain separate because ownership changes at their boundary. Agent-assisted dialogue organizes alternatives and evidence into `decision_trigger`; the human decision maker then owns the adoption, rejection, or deferral recorded in `decisions`. This is the quality guide's handoff point where responsibility changes, even when the two processes occur consecutively in one conversation.

The separate decision activity inventory and collector are removed from the design. The repository's actual decision path is dialogue or asynchronous issue and PR review, both represented by `discuss` followed by `decide`; there is no independent decision-event collection operation to model.

## Persistence and restart contract

Inventory and plan artifacts may remain structured session outputs only while all consumers finish in the same session and the host guarantees access to that session record. No per-run repository file is added.

Before a handoff to another session or subagent, the current retrospective snapshot is persisted in the existing issue or PR. The checkpoint includes the cutoff, source coverage, stable event identifiers, and unresolved findings. If the session is lost before that checkpoint, the old run is abandoned. A replacement run collects all sources again at a new cutoff and does not claim identity with the abandoned run. Human decision checkpoints use the existing `decision_trigger` and `decisions` records in the issue or PR rather than a second inventory format.

Once human decisions have been applied to durable repository artifacts, intermediate inventories need not be retained permanently.

## Independent maintenance processes

The broad `distill_ops`, `distill_local_skills`, and `externalize_bindings` processes are removed. Their outputs have independent canonical locations, edit operations, and validation boundaries, so they become 21 maintenance processes.

### Distributed PFD assets

| Process | Output |
|---|---|
| `maintain_distributed_advisory_hooks` | `distributed_advisory_hooks` |
| `maintain_ecosystem_skill` | `ecosystem_skill` |
| `maintain_grill_skill` | `grill_skill` |
| `maintain_implementer_agent` | `implementer_agent` |
| `maintain_ops_skill_general` | `ops_skill_general` |
| `maintain_ops_skill_github_backend` | `ops_skill_l3` |
| `maintain_pfd_lens_agent` | `pfd_lens_agent` |
| `maintain_retro_skill` | `retro_skill` |
| `maintain_review_perspectives` | `review_perspectives` |

### Repository bindings and guards

| Process | Output |
|---|---|
| `maintain_ops_binding` | `bindings_pfd_ops` |
| `maintain_retro_binding` | `bindings_pfd_retro` |
| `maintain_delegation_guard` | `delegation_guard` |
| `maintain_main_branch_guard` | `main_branch_guard` |
| `maintain_pre_artifact_advisory` | `pre_artifact_advisory` |
| `maintain_workflow_companion` | `workflow_md` |

### Repository-local skills and perspectives

| Process | Output |
|---|---|
| `maintain_distribution_review_perspectives` | `distribution_review_perspectives` |
| `maintain_distribution_review_skill` | `distribution_review_skill` |
| `maintain_prose_mechanization_audit_skill` | `prose_mechanization_audit_skill` |
| `maintain_retro_pattern_sweep_skill` | `retro_pattern_sweep_skill` |
| `maintain_spec_stress_skill` | `spec_stress_skill` |
| `maintain_vscode_ext_debug_skill` | `vscode_ext_debug_skill` |

Every maintenance process has `decisions` as its normal driving input. Each decision names the canonical artifact or artifacts it dispatches to, so a process ignores decisions targeted elsewhere. Inputs of the three removed aggregate processes are not mechanically copied to every replacement process. ADRs, payoff records, review findings, retrospective findings, and sweep records receive normal or feedback edges only when the target artifact definition and its real maintenance procedure show that removing or changing that evidence can change the output. The target output, actual evidence inputs, and validation command are stated in each process description and criteria.

This rule applies the quality guide's counterfactual input test independently after the split. For example, an exact-readback decision can change `ops_skill_l3` without a payoff record, and a concrete retrospective pattern can change `bindings_pfd_retro` without an ADR. Neither absent corpus becomes a false required input merely because its former aggregate process consumed that corpus for a different output.

All 21 processes receive a new `knowledge_maintenance` process tag, following ADR-0019's rule that structurally related process families are grouped by tags rather than a false shared process. The existing `distilled_skill` and `distilled_doc` artifact tags remain, but their descriptions are rewritten as intrinsic artifact classifications and no longer name the removed producer processes.

Shared `make gen-plugin` execution remains represented by the runtime pipeline. It assembles canonical inputs into distributed mirrors and does not merge their maintenance responsibilities.

## Companion and checker migration

The process split changes existing process-name contracts and therefore must update them in the same pull request:

- `.pfdsl/workflow.md` must replace the three broad process names in its knowledge-routing rules and agent/hook inventory instructions.
- `scripts/check-skill-wiring.mjs` must stop treating a `distill_ops` output edge as production evidence. It must instead verify that every required distributed skill or agent artifact has exactly one producer in `workflow.pfdsl` and retains the required runtime-pipeline consumption edge.
- Tests must distinguish a missing producer, duplicate producers, and a valid producer whose name is not hard-coded by the checker.
- References to `externalize_bindings` and neighbor queries based on that process must be replaced with artifact-driven producer queries or an existing authoritative artifact classification.
- The `distilled_skill` and `distilled_doc` tag descriptions must stop naming the removed processes, and process-family queries must use `knowledge_maintenance` rather than a former aggregate producer.
- The old process declarations and edges must be removed completely rather than retained as checker compatibility aliases.

## Validation

The implementation is complete only when all of the following hold:

1. `pfdsl check .pfdsl/workflow.pfdsl --no-color` passes.
2. The removed process ID set is exactly `distill_ops`, `distill_local_skills`, and `externalize_bindings`; the added maintenance process ID set is exactly the 21 IDs listed above.
3. The added retrospective and decision artifacts are exactly `retro_request`, `activity_sources`, `pre_retro_inventory`, `retro_plan`, `retro_findings`, and `decision_trigger`; the added execution processes are exactly `collect_activity`, `plan_retro`, `run_retro`, and `decide`.
4. `user_intent >> discuss`, `discuss -> decision_trigger`, and `decision_trigger >> decide -> decisions` are normal edges. `retro_findings >>? discuss` and the three `retro_skill` edges into collection, planning, and execution are feedback edges. No second producer of `decisions` exists. The `decide` description and criteria name the human decision maker as the sole disposition authority, and the `decisions` criteria require that human authority to be recorded.
5. Paths exist from `decisions` to `ops_skill_l3` and `bindings_pfd_retro`.
6. No old feedback path treats `retro_skill` as a finding or decision input.
7. Every one of the 21 maintained artifacts has a producer; V001 independently rejects duplicate producers.
8. Checker tests fail for missing and duplicate producers and pass for renamed valid producers.
9. Companion prose, tag descriptions, and graph structure name the same responsibilities.
10. `graph orphans`, `graph io`, `graph edges`, and `graph stats` match the declared node and edge migration above, and `make check-docs` plus the relevant script tests pass.
11. The pull request body contains an evidence-edge matrix covering all 21 maintenance processes. For each candidate evidence artifact named by this design, the matrix records whether an edge is present or absent, records the edge kind when present, and gives a one-line counterfactual reason tied to the target artifact and its actual maintenance procedure. The matrix cells must match the canonical edge set returned by `pfdsl graph edges .pfdsl/workflow.pfdsl --json`; any unlisted candidate edge, matrix-only edge, graph-only edge, or edge-kind mismatch fails validation. Review of the matched matrix must show at least one justified evidence edge and reject both mechanical replication of aggregate inputs and omission of every evidence edge.

## Scope boundaries

This change models and validates the workflow. It does not implement a scheduler, a new permanent activity ledger, or automatic repository mutation. Existing session, Git, GitHub, scheduler, issue, and PR records remain authoritative. Runtime-pipeline generation and delivery semantics do not change, so `runtime-pipeline.pfdsl` changes only if implementation reveals an actual delivery-boundary change.
