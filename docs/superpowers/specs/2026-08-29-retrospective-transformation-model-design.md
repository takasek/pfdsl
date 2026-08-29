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

The retrospective side uses two stable inputs:

- `retro_policy` defines the time cutoff, required activity sources, applicable audit layers, and failure behavior.
- `activity_sources` describes how to reach the authoritative session, Git, GitHub, and scheduler records selected by the policy.

The flow is:

```pfdsl
[retro_policy, activity_sources] >> collect_activity -> pre_retro_inventory

pre_retro_inventory >> plan_retro -> retro_plan

[retro_skill, retro_plan] >> run_retro -> retro_findings
```

`pre_retro_inventory` is frozen at the policy cutoff. It records each source query, cutoff, retrieval result, coverage status, and stable event identifiers. It does not record audit or decision dispositions. If a required source is unavailable, the artifact remains incomplete and neither `plan_retro` nor an empty-findings conclusion is permitted.

`retro_plan` records, for every event in the frozen inventory, whether the event participates in this retrospective and why. Classification is non-exclusive. The plan also resolves the concrete PFDs, session evidence, and knowledge artifacts to inspect and records that each subject is reachable. Trigger classification and subject resolution are a single process because the repository has no independent resume or consumer boundary between those operations.

`retro_skill` remains the audit capability. `retro_findings` is the result of applying that capability to one resolved plan. Each finding carries the run identifier and the evidence needed by later human judgment. The old feedback edges from `retro_skill` to discussion and maintenance processes are removed.

## Decision collection and human gate

Decision collection has its own policy and cutoff so that ordinary user, ADR, payoff, or review decisions do not require a retrospective run:

```pfdsl
[decision_policy, activity_sources] >> collect_decision_activity -> decision_inventory

retro_findings >>? collect_decision_activity

decision_inventory >> collect_decision_triggers -> decision_trigger

decision_trigger >> decide -> decisions

[user_intent, retro_findings, findings, adrs, payoff_log] >>? decide
```

`decision_inventory` records source coverage and stable event identifiers for the decision window. When the same cycle produced `retro_findings`, their stable run identifier must appear exactly once. The feedback edge does not make retrospective execution mandatory.

`decision_trigger` records which inventory events require human judgment and why. It does not decide their disposition. `decisions` is the sole artifact that records adoption, rejection, or deferral, together with the human decision maker, evidence references, and a sufficiently concrete change instruction for downstream maintenance.

The process is named `decide`, not `discuss`, because approval may happen asynchronously in an issue or PR without a live dialogue. Existing `user_intent`, review findings, ADRs, and payoff records remain evidence inputs rather than substitutes for the normalized decision trigger.

## Persistence and restart contract

Inventory, plan, and trigger artifacts may remain structured session outputs only while all consumers finish in the same session and the host guarantees access to that session record. No per-run repository file is added.

Before a handoff to another session, subagent, or human reviewer, the current snapshot or decision checkpoint is persisted in the existing issue or PR. The checkpoint includes the cutoff, source coverage, stable event identifiers, and unresolved dispositions. If the session is lost before that checkpoint, the old run is abandoned. A replacement run collects all sources again at a new cutoff and does not claim identity with the abandoned run.

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

Every process has `decisions` as its primary input. Only evidence corpora that the process may actually consult receive feedback edges; the implementation must not mechanically connect all evidence artifacts to every maintenance process. The target output and its validation command are stated in each process description and criteria.

Shared `make gen-plugin` execution remains represented by the runtime pipeline. It assembles canonical inputs into distributed mirrors and does not merge their maintenance responsibilities.

## Companion and checker migration

The process split changes existing process-name contracts and therefore must update them in the same pull request:

- `.pfdsl/workflow.md` must replace the three broad process names in its knowledge-routing rules and agent/hook inventory instructions.
- `scripts/check-skill-wiring.mjs` must stop treating a `distill_ops` output edge as production evidence. It must instead verify that every required distributed skill or agent artifact has exactly one producer in `workflow.pfdsl` and retains the required runtime-pipeline consumption edge.
- Tests must distinguish a missing producer, duplicate producers, and a valid producer whose name is not hard-coded by the checker.
- References to `externalize_bindings` and neighbor queries based on that process must be replaced with artifact-driven producer queries or an existing authoritative artifact classification.
- The old process declarations and edges must be removed completely rather than retained as checker compatibility aliases.

## Validation

The implementation is complete only when all of the following hold:

1. `pfdsl check .pfdsl/workflow.pfdsl --no-color` passes.
2. `graph orphans`, `graph io`, `graph edges`, and `graph stats` show no unintended topology changes.
3. A path exists from `retro_findings` to `decisions`.
4. Paths exist from `decisions` to `ops_skill_l3` and `bindings_pfd_retro`.
5. No old feedback path treats `retro_skill` as a finding or decision input.
6. Every one of the 21 maintained artifacts has exactly one producer.
7. Checker tests fail for missing and duplicate producers and pass for renamed valid producers.
8. Companion prose and graph structure name the same responsibilities.
9. `make check-docs` and the relevant script tests pass.

## Scope boundaries

This change models and validates the workflow. It does not implement a scheduler, a new permanent activity ledger, or automatic repository mutation. Existing session, Git, GitHub, scheduler, issue, and PR records remain authoritative. Runtime-pipeline generation and delivery semantics do not change, so `runtime-pipeline.pfdsl` changes only if implementation reveals an actual delivery-boundary change.
