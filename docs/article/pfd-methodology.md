# Designing a DSL from Shimizu's PFD: What We Kept and What We Changed

> **Status: structural draft (outline).** This document is the skeleton for the
> public article tracked in issue #12. Each section states its thesis, the
> position taken in Yoshio Shimizu's original PFD, the decision made for PFDSL,
> the reasoning, and a concrete example. Prose will be written on top of this
> structure. Source material: `docs/adr/0001`–`0006`.

## Working title candidates

- *Designing a DSL from Shimizu's PFD: What We Kept and What We Changed*
- *Five Subtractions and One Asymmetry: Turning PFD into a Checkable Language*
- *PFD as a Dependency Graph: A DSL Design Story*

---

## 0. Introduction — framing

**Thesis:** PFD (Process Flow Diagram, Yoshio Shimizu) is a notation for drawing
how artifacts are produced and consumed by processes. Turning it into a *DSL*
forces every informal convention to become a decision that can be checked
mechanically. This article walks the line between what survived that translation
unchanged and what we deliberately changed.

Points to cover:

- One-paragraph primer on PFD: artifacts (nouns, things you can store) and
  processes (verbs, transformations), connected by input/output edges. Reference
  the README example.
- Why a DSL at all: a diagram is read by humans; a *language* is read by tools.
  The moment you want `check` / `diff` / `render`, every "you just don't do that"
  convention has to become a rule or a lint.
- The organizing question of the article: **for each design point, did we keep
  Shimizu's stance, tighten it, or drop it — and why did the DSL force the
  choice?**
- A note on method: these decisions were not designed up front. They were
  distilled from practice rounds (drafting realistic domain examples and
  reviewing them) — which is itself the subject of the closing section.

---

## 1. The tangibility asymmetry — outputs must be things, inputs may be formless

*(ADR-0001)*

**Thesis:** Outputs of a process must be tangible, storable, verifiable
artifacts. Inputs that come from *outside* the flow may stay formless. This
asymmetry is the load-bearing rule of the whole method.

- **The tension:** Can a PFD have artifacts like "understanding" or
  "agreement"? Banning them outright breaks the ability to model that a review
  process genuinely depends on "reviewer knowledge" — and hiding that dependency
  contradicts PFD's entire purpose (making implicit dependencies visible).
- **The decision (asymmetric rule):**
  - *Outputs* — only storable, verifiable things. "Understanding" → an
    explainer doc; "agreement" → meeting minutes / a sign-off record.
  - *Inputs* — formless, out-of-flow resources are allowed: "reviewer
    knowledge," "the customer relationship."
- **Why outputs must be tangible (three failures otherwise):**
  1. *No completion test* — "understanding deepened" has no objective done-criterion.
  2. *No status management* — done/wip/todo needs an external judgment call.
  3. *No handoff* — nothing concrete passes to the next process.
- **Why formless inputs are fine — even good:** naming them is *dependency
  visualization*. The spirit of "no implicit dependencies" is not *zero*
  dependencies, it is *visible* ones.
- **The boundary test (carry into the article verbatim):** if you want a
  formless thing as the *output* of an in-flow process, that is the signal to
  externalize it into a document. Sub-test: a task-shaped name like "emergency
  response" fails "is it a storable thing?" — rewrite it to "interim response
  record."
- **Resonance:** XDDP's "spec-out" (Shimizu) is institutionalized
  externalization of understanding — the same direction.
- **Example:** `docs/examples/incident-response.pfdsl` — "interim response record"
  as the externalized artifact.

---

## 2. Revision under the single-producer constraint — three forms, never mixed

*(ADR-0002)*

**Thesis:** The single-producer rule (V001: at most one process may produce a
given artifact) means you cannot just "regenerate" an artifact in place. Yet
revision, review loops, and steady-state cycles are unavoidable in real work.
Three — and only three — modeling forms cover all of it; mixing them is the bug.

- **The constraint:** V001 forbids two processes producing the same artifact, so
  naive "redo this artifact" has no legal drawing.
- **The three forms (chosen by asking "what does the version *mean*?"):**
  1. *Separate artifact* — when the version is a baseline (approved /
     distributed / contracted): `spec_v1 → spec_v2`.
  2. *Convergence loop (`>>?`)* — iteration toward convergence within one phase:
     `comment >>? originating_process`.
  3. *Steady-state cycle (`>>?`)* — unbounded, unenumerable repetition (e.g. ML
     retraining): also `>>?`, with a comment noting the cyclic intent.
- **The rule against mixing:** `>>?` is backward-only (downstream artifact →
  upstream process); duplicating `>>?` over a pair already linked by `>>` is
  redundant and banned.
- **Why this matters (real errors that motivated it):** practice round 2
  produced two concrete mistakes — (a) a book-writing example with both
  `>>? write` *and* a separate `revise` process (double representation of one
  reality); (b) a contract-negotiation example using `>>?` in the forward
  direction.
- **Examples:** `docs/examples/contract-negotiation.pfdsl`,
  `docs/examples/ml-model-dev.pfdsl`.
- **Forward pointer:** the `revises:` metadata field is the scaffold for folding
  version chains and aligning diffs.

---

## 3. No update semantics — mutable resources are snapshots; "update" is a view

*(ADR-0003)*

**Thesis:** Shimizu's original PFD has an *update* concept (mutate an existing
artifact in place). We drop it. Mutable resources are modeled as
point-in-time **snapshot** artifacts; the intuition of "this thing keeps
updating" is delivered by the *rendering view*, not the semantics.

- **What we changed from the original:** this is the clearest *subtraction* from
  Shimizu — name it explicitly.
- **Why update breaks the DSL (four failures):**
  1. *Rank computation* — "post-update me" as my own input creates a cycle.
  2. *Single-producer* — multiple writes to one artifact become ambiguous.
  3. *DAG-ness* — cyclic references kill topological sort.
  4. *Diff stability* — snapshot comparison loses its reference points.
- **The decision:** model mutable resources as time-fixed snapshots — DB state →
  daily dump; production → released version; serving model → traffic snapshot.
- **Semantics / view separation:** the *visual* sense of continuous update is a
  renderer concern — fold a `revises:` chain into a single self-updating-looking
  node. "Running a flow" and "designing a flow" are separate concerns; runtime
  state transition is the domain of state machines, out of PFD's scope.
- **Why snapshots win:** each point is a verifiable checkpoint; it fits PFD's
  actual purpose (planning / progress); it preserves static analyzability (rank,
  reachability, canonical order).
- **Example:** the `model_snapshot_*` artifacts in
  `docs/examples/ml-model-dev.pfdsl`.

---

## 4. Process granularity — three structural rules plus one social rule

*(ADR-0004)*

**Thesis:** Shimizu's stopping rule for splitting processes ("smallest
estimable unit") is vague. We replace it with four concrete criteria: an upper
bound, a lower bound, an indivisibility rule, and a social override — and the
whole thing is isomorphic to microservice design.

- **The problem with the original:** "estimable" is not a real stopping
  criterion; too fine = cluttered, too coarse = hidden dependencies. Practice
  surfaced co-named processes ("venue & sponsor arrangement," "mutual review")
  that exposed the lack of a test.
- **The four criteria:**
  1. *Upper bound — no temporal cohesion.* Don't bundle independent work just
     because it happens at the same time; bundling creates a false dependency
     where all inputs gate all outputs. Co-names ("A & B," "mutual X") are the
     tell.
  2. *Lower bound — no split that adds no new dependency.* If splitting
     introduces no cross-boundary dependency, it adds no information. Don't.
  3. *Indivisible — mutual dependency stays one process.* Decisions formed by
     back-and-forth can't be drawn as a DAG; forcing a split hides a cycle as an
     implicit dependency. Give one process multiple outputs and externalize the
     shared decision into a decision-record artifact. **Test:** can you write the
     pass/fail criterion of the "upstream policy" *without* the downstream work?
     If not, the "upstream policy" is an output, not an input — proof of mutual
     dependency.
  4. *Social axis — ownership boundaries override the structural rules.* A
     handoff point (person/team boundary) is a legitimate reason to split even
     when dependencies don't require it; there the artifact becomes a contract.
- **The microservices parallel (the section's hook):** artifact = API contract;
  no-implicit-dependency = no shared DB; forced split of mutual dependency =
  distributed monolith; rule (4) = Conway's Law. Reverse-Conway: flow-first
  design → owner assignment is the natural order.
- **Corollary:** diagram granularity and execution granularity are separate — an
  AI agent as the worker doesn't justify a coarser diagram; batch subgraphs at
  execution time instead.
- **Example:** the roadmap's own "hierarchy × preset spec drafting" converging
  through "parallel → upstream policy → joint drafting" in three stages
  (`.pfdsl/roadmap.pfdsl`).

---

## 5. No conditional branching — conditions live in artifact labels, not topology

*(ADR-0005)*

**Thesis:** The urge to draw `if/else` (pass/fail, approve/reject) is constant.
We refuse to add branching to the language. A PFD is **not a flowchart** — it is
a dependency graph of artifacts. Wanting a branch is a signal that an artifact is
undefined.

- **Where the urge comes from:** test pass/fail, review approval, threshold
  checks.
- **The decision:** no branching syntax. Reinterpret the urge as a process-design
  (artifact-definition) error.
- **Transformation patterns (the practical heart of the section):**
  - Not "if tests pass →"; instead, *always* output a test-result report, and
    feed a defect ticket (a possibly-empty artifact) back to the originating
    process via `>>?`.
  - Not "if approved →"; instead, define an approval record as an artifact; the
    downstream process takes it as input (no record ⇒ doesn't run).
- **Why branching breaks the DSL (three failures):**
  1. *Static analyzability* — rank / reachability / canonical order become
     runtime-condition-dependent.
  2. *State-machine overlap* — branch + loop equals a state machine; PFD
     shouldn't absorb that concern.
  3. *Workflow-engine creep* — engine-specific execution semantics leak into the
     meaning of the language.
- **Continuity with the original:** Shimizu's PFD also has no branching — this is
  a *kept* decision, and it aligns with "keep the language minimal."
- **Review payoff:** the reusable question "when you want a branch, which
  artifact is undefined?"

---

## 6. Meta-story — rules vs. tooling, and how the method was validated by practice

*(ADR-0006)*

**Thesis:** The closing turn. After writing the quality guide, practice round 2
*re-produced mistakes the guide explicitly warned about*. That failure is the
evidence for a two-layer quality model: rules handle what needs judgment; lints
handle what can be checked mechanically. And the practice-round loop itself is
how every decision above was earned.

- **The embarrassing-but-honest data point:** mistakes recurred *despite* being
  written in the guide — e.g. a derivative-development process missing
  `base_code` as input (the exact error was in the guide's own example); two
  un-consumed artifacts left in place. Rules alone have a ceiling.
- **The two-layer split:**
  - *Rules (the guide)* — design-judgment mistakes: process granularity,
    revision form, naming/externalization, ownership-boundary splits.
  - *Tools (lints)* — mechanically checkable properties: cycle detection,
    terminal audit (un-consumed artifacts), input-sufficiency hints (isolated
    artifacts), orphan `parts`, redundant `>>?`.
- **Why the split is principled:** mistakes requiring *exhaustive enumeration*
  can't be prevented by stating a rule — that's a cognitive limit, not a rule-
  quality problem. "Rules handle only what can't be handed to a machine."
- **The method's self-validation:** the practice → review loop did two things —
  it tightened the guide *and* it empirically derived the lint target list and
  its priorities by measuring which mistakes the rules eliminated and which
  survived. The value of practice rounds extended from "guide quality" to "tool
  requirements."
- **Closing frame:** the five design decisions above are not axioms handed down;
  they are what's left standing after the method was run against itself.

---

## Appendix / craft notes (not article sections)

- **Audience:** developers and methodology-minded readers who may know flowcharts
  / BPMN but not PFD. Don't assume Shimizu familiarity; do one primer paragraph.
- **Tone:** design-decision narrative, not reference docs. Each section is a
  small "we hit a wall → here's the call we made → here's why."
- **Recurring spine:** keep the "kept / tightened / dropped vs. Shimizu" framing
  visible in every section so the article reads as one argument, not six.
- **Snippets:** prefer the README's running example shape; pull concrete PFDSL
  from `docs/examples/` rather than inventing.
- **Open dependency note (from issue #12):** soft-depends on multifile-semantics
  (#5/#6) and spec v0.0.7 landing — the article gets richer afterward but does
  not block on it.
- **Terminal-deliverable note:** the article is a true terminal deliverable
  (`i12_article`); done-criterion is external publication with a URL.
