# Claude Code / Codex Dual-Harness Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate deterministic Claude Code and native Codex repository/plugin assets from one maintained distribution inventory without requiring Codex users to install or import Claude Code.

**Architecture:** Keep `.claude` as the short-term canonical input, extract the product capability inventory from the Claude-specific mirror table, and feed explicit Claude Code and Codex adapters from that inventory. Preserve the existing Claude Code output byte-for-byte while adding Codex plugin skills/hooks plus repository-scoped `AGENTS.md`, `.agents/skills`, `.codex/agents`, and `.codex/hooks.json` outputs.

**Tech Stack:** Node.js 24 ESM, `node:test`, YAML parsing through the existing `yaml` dependency, JSON/TOML text generation, PFDSL CLI 0.0.25.

**Spec:** `docs/superpowers/specs/2026-08-22-codex-dual-harness-design.md`

## Global Constraints

- `.claude/skills`, `.claude/agents`, and `.claude/commands` remain canonical inputs in this change.
- Existing Claude Code plugin outputs remain identity-compatible.
- Codex plugin consumers receive native skills and hooks through `.codex-plugin/plugin.json`; Codex project subagents remain repository-scoped under `.codex/agents` because the Codex plugin manifest has no subagent component field.
- Generated Codex outputs are not hand-edited.
- Unsupported source constructs fail with the source path and construct name instead of being silently omitted.
- No plugin, CLI package, or extension is published in this issue.
- Every production-code change follows Red → Green → Refactor and ends in a logical Conventional Commit.

---

## File Structure

- Create `scripts/lib/harness-inventory.mjs` — harness-neutral capability inventory and source accounting.
- Create `scripts/lib/harness-inventory.test.mjs` — inventory completeness and exclusion tests.
- Create `scripts/lib/gen-codex-assets.mjs` — pure Codex manifest, command-skill, agent-TOML, instruction, and hook transforms.
- Create `scripts/lib/gen-codex-assets.test.mjs` — transform unit tests and fail-closed cases.
- Create `scripts/gen-codex-assets.mjs` — filesystem assembly entry point for repository and plugin outputs.
- Modify `scripts/lib/gen-plugin.mjs` — consume the shared inventory and invoke Codex assembly without changing Claude output semantics.
- Modify `scripts/lib/gen-plugin.test.mjs` — integration expectations for both manifests and output roots.
- Modify `scripts/lib/gen-plugin-trigger.mjs` and its test — include Codex generator/output paths in drift triggers.
- Modify `scripts/lib/drift-gates.mjs` — compare tracked Codex outputs during the dist-independent plugin gate.
- Modify `scripts/lib/intentional-duplication.test.mjs` — account for project agents through the shared inventory.
- Generate `AGENTS.md`, `.agents/skills/**`, `.codex/agents/*.toml`, `.codex/hooks.json`, `plugin/pfdsl/.codex-plugin/plugin.json`, and `plugin/pfdsl/skills/pfd-{cycle,init,retro}/SKILL.md`.
- Modify `.pfdsl/workflow.pfdsl`, `.pfdsl/workflow.md`, `.pfdsl/runtime-pipeline.pfdsl`, and `.pfdsl/runtime-pipeline.md` — model the dual adapters, outputs, and maintenance procedure.

---

### Task 1: Extract a Harness-Neutral Distribution Inventory

**Files:**
- Create: `scripts/lib/harness-inventory.mjs`
- Create: `scripts/lib/harness-inventory.test.mjs`
- Modify: `scripts/lib/gen-plugin.mjs`
- Modify: `scripts/lib/intentional-duplication.test.mjs`

**Interfaces:**
- Consumes: existing `.claude/skills`, `.claude/commands`, `.claude/agents`, and `hooks` paths.
- Produces: `DISTRIBUTED_SKILLS`, `DISTRIBUTED_COMMANDS`, `DISTRIBUTED_AGENTS`, `AGENT_EXCLUSIONS`, and `CLAUDE_PLUGIN_MIRRORS` exports used by both adapters.

- [ ] **Step 1: Write the failing inventory tests**

Create tests that import the new module and assert the current product set exactly:

```js
assert.deepEqual(DISTRIBUTED_SKILLS, [
  "pfd-grill",
  "pfd-ops",
  "pfd-retro",
  "pfd-ecosystem",
]);
assert.deepEqual(DISTRIBUTED_COMMANDS, [
  "pfd-cycle.md",
  "pfd-init.md",
  "pfd-retro.md",
]);
assert.deepEqual(DISTRIBUTED_AGENTS, ["pfd-lens.md", "pfd-implementer.md"]);
```

Also enumerate `.claude/agents/*.md` and assert that every file is distributed or has a non-empty exclusion reason.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/lib/harness-inventory.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `harness-inventory.mjs`.

- [ ] **Step 3: Implement the inventory and adapt the Claude generator**

Export frozen arrays/objects from `harness-inventory.mjs`. Build `CLAUDE_PLUGIN_MIRRORS` from those exports:

```js
export const CLAUDE_PLUGIN_MIRRORS = Object.freeze([
  { dest: "skills", src: ".claude/skills", trees: DISTRIBUTED_SKILLS },
  { dest: "commands", src: ".claude/commands", files: DISTRIBUTED_COMMANDS },
  { dest: "agents", src: ".claude/agents", files: DISTRIBUTED_AGENTS },
  { dest: "hooks", src: "hooks", whole: true },
]);
```

Make `gen-plugin.mjs` re-export the legacy constant names where existing imports require them, but remove its independent lists. Do not change `assemblePluginDistIndependent()` output paths or manifest bytes.

- [ ] **Step 4: Verify GREEN and Claude identity**

Run: `node --test scripts/lib/harness-inventory.test.mjs scripts/lib/gen-plugin.test.mjs scripts/lib/intentional-duplication.test.mjs`

Expected: all tests pass.

Run: `node scripts/gen-plugin-dist-independent.mjs && git diff --exit-code -- plugin/pfdsl .claude-plugin/marketplace.json`

Expected: exit 0 and no Claude output diff.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/harness-inventory.mjs scripts/lib/harness-inventory.test.mjs scripts/lib/gen-plugin.mjs scripts/lib/intentional-duplication.test.mjs
git commit -m "refactor(plugin): share harness asset inventory" -m "Review: tool=design"
```

### Task 2: Implement Pure Codex Adapters

**Files:**
- Create: `scripts/lib/gen-codex-assets.mjs`
- Create: `scripts/lib/gen-codex-assets.test.mjs`

**Interfaces:**
- Consumes: source text and inventory entries from Task 1.
- Produces: `buildCodexPluginManifest`, `commandToCodexSkill`, `agentToCodexToml`, `claudeInstructionsToAgents`, and `claudeHooksToCodexHooks` pure functions.

- [ ] **Step 1: Write failing manifest and command-skill tests**

Assert this manifest shape:

```js
assert.deepEqual(buildCodexPluginManifest({ version: "1.2.3", description: "x" }), {
  name: "pfdsl",
  version: "1.2.3",
  description: "x",
  author: { name: "takasek" },
  homepage: "https://github.com/takasek/pfdsl",
  repository: "https://github.com/takasek/pfdsl",
  license: "MIT",
  skills: "./skills/",
  hooks: "./hooks/hooks.json",
});
```

For a command containing `description` frontmatter and `$ARGUMENTS`, assert that `commandToCodexSkill("pfd-cycle.md", source)` returns a `name: pfd-cycle` skill, preserves the description/body, and replaces `引数（あれば作業選択の指定として扱う）: $ARGUMENTS` with `ユーザーがスキル呼び出しとともに指定した内容があれば、作業選択の指定として扱う。`.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/lib/gen-codex-assets.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement manifest and command-skill conversion**

Parse frontmatter with `yaml.parse`, require a non-empty `description`, and emit:

```md
---
name: pfd-cycle
description: <source description>
---

<source command body with an explicitly tested Codex argument instruction>
```

Reject unknown frontmatter keys instead of dropping them.

- [ ] **Step 4: Write failing agent, instruction, and hook tests**

Use `.claude/agents/pfd-implementer.md`, `CLAUDE.md`, and `.claude/settings.json` shaped fixtures. Assert:

```js
assert.match(agentToCodexToml("pfd-implementer.md", source), /description = /);
assert.match(agentToCodexToml("pfd-implementer.md", source), /developer_instructions = """/);
assert.doesNotMatch(claudeInstructionsToAgents(source), /\.Codex\/settings\.json/);
assert.match(claudeInstructionsToAgents(source), /\.codex\/hooks\.json/);
assert.deepEqual(JSON.parse(claudeHooksToCodexHooks(settings)).hooks, settings.hooks);
```

Assert that unsupported Claude agent `model` or `tools` values are either mapped by an explicit lookup table or rejected with the source path and key.

- [ ] **Step 5: Implement the remaining pure transforms and verify GREEN**

Emit TOML using deterministic key order: `description`, optional supported Codex config keys, then triple-quoted `developer_instructions`. Preserve the Markdown body verbatim except for repository-instruction filename/path substitutions covered by tests. Copy only the `hooks` object from `.claude/settings.json`; Claude `permissions.allow` is not a Codex hook and must not be silently translated.

Run: `node --test scripts/lib/gen-codex-assets.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/gen-codex-assets.mjs scripts/lib/gen-codex-assets.test.mjs
git commit -m "feat(codex): add native asset adapters" -m "Review: tool=design"
```

### Task 3: Assemble Repository and Codex Plugin Outputs

**Files:**
- Create: `scripts/gen-codex-assets.mjs`
- Modify: `scripts/lib/gen-plugin.mjs`
- Modify: `scripts/lib/gen-plugin.test.mjs`
- Create/Generate: `AGENTS.md`
- Create/Generate: `.agents/skills/**`
- Create/Generate: `.codex/agents/*.toml`
- Create/Generate: `.codex/hooks.json`
- Create/Generate: `plugin/pfdsl/.codex-plugin/plugin.json`
- Create/Generate: `plugin/pfdsl/skills/pfd-cycle/SKILL.md`
- Create/Generate: `plugin/pfdsl/skills/pfd-init/SKILL.md`
- Create/Generate: `plugin/pfdsl/skills/pfd-retro/SKILL.md`

**Interfaces:**
- Consumes: Task 1 inventory and Task 2 pure adapters.
- Produces: `assembleCodexAssets({ root, pluginRoot, deps })` and a CLI entry point that atomically replaces generated destinations.

- [ ] **Step 1: Write failing assembly tests**

Inject filesystem dependencies as `assemblePluginDistIndependent` already does. Assert calls/writes for:

```js
[
  "AGENTS.md",
  ".codex/hooks.json",
  "plugin/pfdsl/.codex-plugin/plugin.json",
  "plugin/pfdsl/skills/pfd-cycle/SKILL.md",
  "plugin/pfdsl/skills/pfd-init/SKILL.md",
  "plugin/pfdsl/skills/pfd-retro/SKILL.md",
]
```

Assert each distributed skill is mirrored to `.agents/skills/<name>` and each project agent is converted to `.codex/agents/<basename>.toml`. Seed stale destination files and assert they disappear only after a complete successful staging write.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/lib/gen-plugin.test.mjs`

Expected: FAIL because `assembleCodexAssets` and Codex writes do not exist.

- [ ] **Step 3: Implement atomic assembly**

Use a sibling temporary directory per destination tree, populate it fully, then rename it over the destination. Write individual files through temporary siblings followed by rename. `scripts/gen-codex-assets.mjs` resolves the repository root and calls the injectable assembly function.

Call Codex assembly from `assemblePluginDistIndependent()` after the existing Claude mirrors and manifest generation, so `node scripts/gen-plugin-dist-independent.mjs` remains the single dist-independent regeneration entry point.

- [ ] **Step 4: Verify GREEN and generate tracked outputs**

Run: `node --test scripts/lib/gen-plugin.test.mjs scripts/lib/gen-codex-assets.test.mjs`

Expected: all tests pass.

Run: `node scripts/gen-plugin-dist-independent.mjs`

Expected: generated Codex files appear, while existing Claude files have no semantic diff.

Run: `git diff --check && node scripts/check-md-linebreaks.mjs AGENTS.md`

Expected: exit 0.

- [ ] **Step 5: Commit source and generated outputs together**

```bash
git add scripts/gen-codex-assets.mjs scripts/lib/gen-plugin.mjs scripts/lib/gen-plugin.test.mjs AGENTS.md .agents .codex plugin/pfdsl
git commit -m "feat(codex): generate repository and plugin assets" -m "Review: tool=design" -m "Review: tool=experience"
```

### Task 4: Extend Drift Gates and Trigger Coverage

**Files:**
- Modify: `scripts/lib/gen-plugin-trigger.mjs`
- Modify: `scripts/lib/gen-plugin-trigger.test.mjs`
- Modify: `scripts/lib/drift-gates.mjs`
- Modify: `scripts/lib/drift-gates.test.mjs`

**Interfaces:**
- Consumes: generated paths and generator entry point from Task 3.
- Produces: a gate that regenerates and compares Claude and Codex outputs together.

- [ ] **Step 1: Write failing trigger tests**

Assert `GEN_PLUGIN_TRIGGER` matches:

```js
for (const path of [
  "scripts/lib/harness-inventory.mjs",
  "scripts/lib/gen-codex-assets.mjs",
  "scripts/gen-codex-assets.mjs",
  "AGENTS.md",
  ".agents/skills/pfd-ops/SKILL.md",
  ".codex/agents/pfd-implementer.toml",
  ".codex/hooks.json",
  "plugin/pfdsl/.codex-plugin/plugin.json",
]) assert.equal(GEN_PLUGIN_TRIGGER.test(path), true, path);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/lib/gen-plugin-trigger.test.mjs scripts/lib/drift-gates.test.mjs`

Expected: failures for unrecognized Codex paths and missing compare targets.

- [ ] **Step 3: Extend the trigger and bulk drift target**

Derive source alternations from the Task 1 inventory. Add generated Codex roots to `GEN_PLUGIN_TRIGGER_PATTERN`. Extend the `gen-plugin-bulk` compare paths to include `AGENTS.md`, `.agents`, and `.codex` while retaining the existing exclusion for the dist-dependent pfdsl `SKILL.md`.

Update the gate hint to name both Claude and Codex outputs and keep `node scripts/gen-plugin-dist-independent.mjs` as the corrective command.

- [ ] **Step 4: Verify GREEN and prove the gate sees drift**

Run: `node --test scripts/lib/gen-plugin-trigger.test.mjs scripts/lib/drift-gates.test.mjs`

Expected: all tests pass.

In a temporary test fixture, alter one generated Codex file and assert the bulk gate reports a diff; do not hand-edit tracked output in the worktree for this proof.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/gen-plugin-trigger.mjs scripts/lib/gen-plugin-trigger.test.mjs scripts/lib/drift-gates.mjs scripts/lib/drift-gates.test.mjs
git commit -m "test(codex): enforce generated asset identity" -m "Review: tool=correctness"
```

### Task 5: Model and Document the Dual-Harness Flow

**Files:**
- Modify: `.pfdsl/workflow.pfdsl`
- Modify: `.pfdsl/workflow.md`
- Modify: `.pfdsl/runtime-pipeline.pfdsl`
- Modify: `.pfdsl/runtime-pipeline.md`

**Interfaces:**
- Consumes: actual generator paths and output locations implemented in Tasks 1–4.
- Produces: PFD nodes/edges and companion procedures that match the implemented generation and distribution flow.

- [ ] **Step 1: Capture topology before editing**

Run:

```bash
node packages/cli/dist/cli.js graph neighbors .pfdsl/workflow.pfdsl plugin_dist
node packages/cli/dist/cli.js graph neighbors .pfdsl/runtime-pipeline.pfdsl gen_plugin
node packages/cli/dist/cli.js graph io .pfdsl/workflow.pfdsl --json
node packages/cli/dist/cli.js graph io .pfdsl/runtime-pipeline.pfdsl --json
```

Use the command output as the edge source of truth for Step 2; do not infer producer or consumer IDs from node names.

- [ ] **Step 2: Update PFD nodes and edges**

Represent maintained harness inventory, Claude adapter output, Codex adapter output, repository Codex assets, and the combined plugin distribution. Use the implemented paths in `location:` fields. Do not add `status:` to workflow or runtime-pipeline artifacts.

Keep generation mechanics in `runtime-pipeline.pfdsl`; keep maintainer decisions and knowledge externalization in `workflow.pfdsl`. Run `fmt --write` after each file edit.

- [ ] **Step 3: Update companion procedures**

Document `.claude` as the current canonical input, generated-output edit prohibition, the regeneration command, Codex plugin limitations, and the future neutral-source migration seam. Remove or qualify statements that call the bundle Claude-only.

- [ ] **Step 4: Validate PFDs and links**

Run:

```bash
node packages/cli/dist/cli.js check .pfdsl/workflow.pfdsl --strict --no-color
node packages/cli/dist/cli.js check .pfdsl/runtime-pipeline.pfdsl --strict --no-color
node packages/cli/dist/cli.js graph io .pfdsl/workflow.pfdsl --json
node packages/cli/dist/cli.js graph io .pfdsl/runtime-pipeline.pfdsl --json
node packages/cli/dist/cli.js graph orphans .pfdsl/workflow.pfdsl
node packages/cli/dist/cli.js graph orphans .pfdsl/runtime-pipeline.pfdsl
node packages/cli/dist/cli.js meta check-links .pfdsl/workflow.pfdsl
node packages/cli/dist/cli.js meta check-links .pfdsl/runtime-pipeline.pfdsl
```

Expected: strict checks and links pass; any orphan output contains groups only; terminals are true deliverables or are consumed in the sibling graph and documented as such.

- [ ] **Step 5: Commit**

```bash
git add .pfdsl/workflow.pfdsl .pfdsl/workflow.md .pfdsl/runtime-pipeline.pfdsl .pfdsl/runtime-pipeline.md
git commit -m "docs(workflow): model dual-harness generation"
```

### Task 6: End-to-End Verification and Completion State

**Files:**
- Modify: `.pfdsl/roadmap.pfdsl` (`dual_harness_assets.status` only after every criterion passes)
- Regenerate: all outputs from Tasks 3–4.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: a verified, review-ready branch with the roadmap artifact marked done only when its original criteria are met.

- [ ] **Step 1: Regenerate and require a clean second pass**

Run twice:

```bash
node scripts/gen-plugin-dist-independent.mjs
node scripts/gen-plugin-dist-independent.mjs
```

Expected: the second run produces no diff.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
node --test scripts/lib/harness-inventory.test.mjs scripts/lib/gen-codex-assets.test.mjs scripts/lib/gen-plugin.test.mjs scripts/lib/gen-plugin-trigger.test.mjs scripts/lib/drift-gates.test.mjs scripts/lib/intentional-duplication.test.mjs
make test
make typecheck
make lint
make check-docs
```

Expected: all commands exit 0.

- [ ] **Step 3: Perform native-consumer scenario checks**

Inspect `plugin/pfdsl/.codex-plugin/plugin.json`, resolve every relative path, and verify each referenced skill/hook exists inside `plugin/pfdsl`. Start a fresh Codex task against the repository and confirm `pfd-ops`, `pfd-cycle`, and `pfd-retro` are discoverable without reading `.claude`; record observed tool/skill discovery rather than inferring it from files.

- [ ] **Step 4: Run required review perspectives**

Run quality review for maintainability, design/correctness review that attempts to falsify each new fact claim, and experience review using a blank consumer scenario. Record trailers on the final code commit as required by `roadmap.md`.

- [ ] **Step 5: Mark the roadmap artifact done and run the terminal gate**

Only after Steps 1–4 pass:

```bash
node packages/cli/dist/cli.js meta set .pfdsl/roadmap.pfdsl dual_harness_assets status done
node packages/cli/dist/cli.js check .pfdsl/roadmap.pfdsl --strict --no-color
GH_HOST=github.com node scripts/gate-check.mjs --base main --artifact dual_harness_assets --issue 956
```

Expected: PFD check passes; the gate reports no unresolved FAIL items. Leave issue closure and merge-time flow synchronization to the human merge workflow.

- [ ] **Step 6: Commit completion state**

```bash
git add .pfdsl/roadmap.pfdsl
git commit -m "docs(roadmap): complete dual-harness assets" -m "Review: tool=correctness" -m "Review: tool=experience"
```
