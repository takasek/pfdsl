# Codex Worktree Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce routine Codex worktree approval prompts without weakening pfdsl's main and sibling-worktree guards.

**Architecture:** Read-only and build commands use `exec_command.workdir`, while approval-sensitive mutations use an exact-operation wrapper that carries the absolute worktree and expected branch in argv. The wrapper validates cwd, target, non-main ownership, branch, and arity; pfdsl's guard reads the same explicit target. Claude Code keeps `CLAUDE_PROJECT_DIR` and ask decisions; Codex falls back to payload `cwd` and converts unsupported asks to denies.

**Tech Stack:** Markdown agent instructions, Codex prefix rules, Node.js ESM, `node:test`, Git worktrees.

**Spec:** `docs/superpowers/specs/2026-08-24-codex-worktree-approval-design.md`

## Global Constraints

Claude Code behavior must remain unchanged when `CLAUDE_PROJECT_DIR` is present.

Codex must detect sibling worktree mutations without requiring `git -C <variable-absolute-path>` as the normal command form.

No rule may allow force-push, history rewrite, merge, publish, issue close, branch deletion, or creation of a new public destination without confirmation.

The existing #981 generator worktree and generated assets are out of scope.

---

### Task 1: Stabilize user-level command and continuation policy

**Files:**
- Modify: `/Users/m5/.codex/AGENTS.md`
- Modify: `/Users/m5/.codex/RTK.md`
- Modify: `/Users/m5/.codex/rules/default.rules`
- Modify: `CLAUDE.md`
- Regenerate: `AGENTS.md`

**Interfaces:**
- Consumes: Codex `exec_command.workdir` and user-level `prefix_rule` matching.
- Produces: Fixed routine command prefixes and a narrow stop boundary.

- [x] **Step 1: Replace the Bash worktree workaround**

Specify that every Codex shell call sets `workdir` to the exact worktree and uses a canonical relative command, while harnesses without a workdir field retain absolute `-C` or script paths.

- [x] **Step 2: Narrow the post-failure stop trigger**

Exclude known prerequisite steps, the next step of the same documented workflow, same-verification reruns, and one same-tool argument correction from the no-lateral-move rule.

- [x] **Step 3: Preserve prefix identity across RTK**

Document that commands relying on Codex prefix rules run in their original canonical form rather than behind `rtk`.

- [x] **Step 4: Add safe routine prefixes**

Add allow rules for the exact-arity Git routine wrapper, `pnpm -r build`, `pnpm test`, and `pnpm typecheck`. The wrapper rejects suffixes that a prefix-only rule cannot express, while negative examples prove unrelated deletion, publish, or push commands do not match.

- [x] **Step 5: Avoid duplicate worktree setup**

Document the shared SessionStart `make setup` behavior in `CLAUDE.md`, regenerate `AGENTS.md`, and retain manual setup only for worktrees created after session start or otherwise missed by the hook.

### Task 2: Add Codex session-root regression coverage

**Files:**
- Modify: `scripts/lib/main-commit-guard.test.mjs`

**Interfaces:**
- Consumes: Wrapper stdin payload with `cwd` and an environment that may omit `CLAUDE_PROJECT_DIR`.
- Produces: End-to-end assertions for Codex and Claude session-root selection.

- [x] **Step 1: Write the failing Codex fixture**

Run the wrapper without `CLAUDE_PROJECT_DIR`, pass the session worktree in payload `cwd`, target the sibling with `git -C`, and expect `permissionDecision: "deny"`.

- [x] **Step 2: Verify RED**

Run `node --test scripts/lib/main-commit-guard.test.mjs` and confirm the Codex fixture fails because the current wrapper creates no session roots without `CLAUDE_PROJECT_DIR`.

- [x] **Step 3: Add the Claude precedence fixture**

Pass `CLAUDE_PROJECT_DIR=session`, set payload `cwd=sibling`, run `git add -A`, and assert it is allowed because the Claude environment remains authoritative.

### Task 3: Implement the shared harness adapter

**Files:**
- Modify: `scripts/main-commit-guard.mjs`

**Interfaces:**
- Consumes: `payload.cwd` and `process.env.CLAUDE_PROJECT_DIR`.
- Produces: A session root path selected as `CLAUDE_PROJECT_DIR ?? payload.cwd` before Git-root resolution.

- [x] **Step 1: Implement the minimal fallback**

Change `resolveBranches(_payload, targetCwd)` to read `payload`, select a non-empty Claude project directory first, otherwise a non-empty payload `cwd`, and resolve roots only for that selected path.

- [x] **Step 2: Verify GREEN**

Run `node --test scripts/lib/main-commit-guard.test.mjs` and confirm the Codex sibling fixture and all existing Claude fixtures pass.

- [x] **Step 3: Refactor comments only after GREEN**

Update the wrapper comment to describe the harness-neutral session-root adapter without changing decisions.

### Task 4: Verify and commit

**Files:**
- Verify: `scripts/lib/main-commit-guard.test.mjs`
- Verify: all tracked changes and generated-output status.

**Interfaces:**
- Consumes: Tasks 1 through 3.
- Produces: Reviewable local commits without an unapproved public destination.

- [ ] **Step 1: Run focused and repository checks**

Run `node --test scripts/lib/main-commit-guard.test.mjs`, `pnpm typecheck`, `pnpm test`, and the repository's generated-drift check discovered from current Makefile/package scripts.

- [ ] **Step 2: Inspect exact status and diff**

Run `git status --short`, `git diff --check`, and `git diff --stat`, and confirm no #981 generator files changed.

- [ ] **Step 3: Commit logical units**

Commit the design record separately from the tested hook behavior, using English Conventional Commit messages.

- [ ] **Step 4: Stop before public creation**

Report the local branch and commits; do not push a new branch or create a PR until the user explicitly authorizes that new public destination.

### Task 5: Harden compound-command session-root resolution

**Files:**
- Modify: `scripts/lib/main-commit-guard.test.mjs`
- Modify: `scripts/main-commit-guard.mjs`

- [x] Add failing coverage for whitespace-only session roots, `cd -- <path>`, redirected literal `cd`, and unresolved dynamic `cd` values.
- [x] Treat whitespace-only roots as absent, preserve valid Claude precedence, resolve supported literal `cd` forms, and fail closed when the effective cwd cannot be resolved.
- [x] Re-run the focused guard suite and review the behavior and messages.

### Task 6: Make worktree setup completion explicit

**Files:**
- Add: `scripts/lib/setup-completion.test.mjs`
- Modify: `Makefile`
- Modify: `.claude/settings.json`
- Modify: `CLAUDE.md`
- Regenerate: `.codex/hooks.json`
- Regenerate: `AGENTS.md`

- [x] Add a failing behavioral contract for `node_modules/.pfdsl-setup-complete`.
- [x] Touch the marker only after install, hook installation, and repository-skill linking all succeed; SessionStart checks the marker rather than `node_modules`.
- [x] Regenerate Codex assets and run the focused setup contract.

### Task 7: Constrain routine Git approvals with a strict user wrapper

**Files:**
- Add: `/Users/m5/.codex/bin/codex-git-routine.mjs`
- Add: temporary wrapper tests outside the repository
- Modify: `/Users/m5/.codex/rules/default.rules`
- Modify: `/Users/m5/.codex/AGENTS.md`
- Modify: `/Users/m5/.codex/RTK.md`

- [x] Test exact `fetch-origin` and `worktree-add` arity plus rejection of suffixes, refspecs, traversal, absolute paths, symlink ancestors, and `--force`.
- [x] Execute Git with fixed argv arrays only after repository-relative path, symlink, branch, and canonical remote-ref validation.
- [x] Replace direct raw Git allow rules with wrapper-subcommand prefixes and validate positive and negative examples through Codex execpolicy.

### Task 8: Synchronize the model, records, reviews, and PR

**Files:**
- Modify: `.pfdsl/workflow.pfdsl`
- Modify: the design and implementation plan
- Verify: generated assets and all changed code

- [x] Update `main_branch_guard` metadata through the local pfdsl CLI and validate links and graph structure.
- [x] Run focused tests, typecheck, full repository tests, generated-drift checks, and the terminal gate.
- [ ] Record simplify, correctness, and experience reviews in a logical commit, push the requested branch normally, and create the requested PR without merging it.

### Task 9: Close the adversarial host-contract findings

**Files:**
- Modify: `scripts/lib/delegation-guard.mjs`
- Modify: `scripts/lib/main-commit-guard.mjs`
- Modify: `scripts/main-commit-guard.mjs`
- Modify: `scripts/setup-completion.mjs`
- Modify: `scripts/lib/setup-completion.test.mjs`
- Modify: the user-level wrapper, rules, AGENTS, and RTK companion files

- [x] Convert Claude-compatible ask decisions to deny when the host is Codex, whose PreToolUse contract does not support ask.
- [x] Parse quoted Git argv and `env` options without confusing quoted prose for an executable command.
- [x] Carry mutation targets explicitly through the user wrapper and teach the repository guard to compare them with the session root.
- [x] Derive the main repository root from `--git-common-dir`, and reject main, mismatched workdir, mismatched branch, extra argv, and unsafe worktree destinations before mutation.
- [x] Replace raw Git allow prefixes with wrapper-only prefixes, including exact setup and full-test targets.
- [x] Fingerprint setup inputs so a marker becomes stale when a branch changes the setup contract.
- [x] Track `env` cwd changes and fail closed on repository-target Git flags and unresolved shell prefixes.
- [x] Serialize setup, recheck the marker after lock acquisition, and replace the marker atomically.
- [x] Restrict every globally allowed wrapper routine to the realpath-verified pfdsl trusted root and remove raw package-script allow rules.
- [x] Re-run the full verification matrix and an adversarial review against all six original findings.
