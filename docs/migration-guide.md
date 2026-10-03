# Migration guide

Use this guide when upgrading an existing pfdsl installation.
Release-specific cleanup instructions live here; distributed skills link here rather than retaining old migration rules.
Run applicable steps in the adopting repository, preserving local changes and following its approval rules.

## Choosing the update range

Record both the installed and target CLI/plugin releases, including the bundle revision when package versions alone are ambiguous.
Read the entries introduced after the installed release and through the target release, in release order; skip entries outside that interval.
Changing a version number alone is not evidence that old local copies have been cleaned up.

## CLI/plugin v0.1.0 — after CLI/plugin v0.0.26

This section covers the changes between CLI/plugin v0.0.26 and v0.1.0, including specification versions v0.0.22–v0.0.26.
CLI/package versions and specification versions are separate.
A development build made between these releases can report package version 0.0.26 while containing some of these changes; identify it by its bundle revision.
The [specification history](spec/spec-history.md) provides additional technical context, not a substitute for this guide's CLI and workflow migration coverage.

A dependency range written for 0.0.x, such as `^0.0.26`, does not admit 0.1.0.
If the repository declares `@pfdsl/cli` in `package.json`, change the declared range to the target release.

Before editing, record the installed CLI/plugin identity, the affected files, and validation results with the intended upgrade.
Edit the adopting repository's sources, not plugin caches or generated distribution files.

### Optional knowledge lifecycle audit

The pfd-retro D layer now requires an explicit declaration in the repository's `.pfdsl/config.json`, a git-managed file for adopter-side declared values ([ADR-0042](adr/0042-adopter-config-file.md)).
An old D heading, extra audit rules, or a declaration line in `.pfdsl/bindings/pfd-retro.md` no longer enable it.
The former Japanese declaration line (`知識成果物ライフサイクル監査: 採用する`) is not recognized; retro reports that the declaration has moved.

Ask the repository owner whether to continue this audit, then add one of these to `.pfdsl/config.json` (create the file if it does not exist, and keep any other keys):

- `"knowledgeLifecycleAudit": {"mode": "adopt", "targets": [...]}` — continue the audit. List each artifact to audit as a string, such as `"docs/adr/"` or `"the criteria of .pfdsl/roadmap.pfdsl"`; only listed artifacts are audited.
- `"knowledgeLifecycleAudit": {"mode": "decline"}` — stop the audit; retro neither audits nor reports the D layer.

Until a valid declaration exists, retro does not audit the D layer and reports on every run what is wrong and that the owner must declare it.
This covers a missing file, invalid JSON, a missing key, an invalid `mode`, and `adopt` without a non-empty list of targets.
Do not infer the targets from descriptions or future plans.
Replace the old declaration in the binding with a pointer to the config key; the current binding scaffold has the wording.
If declining, remove obsolete active D-layer instructions and links after checking their consumers; retain historical records and content needed by other audit layers.
See [ADR-0039](adr/0039-distribution-scope-by-provided-purpose.md), [ADR-0041](adr/0041-retro-d-layer-declaration-token.md), and [Issue #1275](https://github.com/takasek/pfdsl/issues/1275).

### Retro catalog retirement

This interval also retires the former retro catalog and its dedicated notification paths.
Follow [the retro binding migration instructions in #1177](https://github.com/takasek/pfdsl/issues/1177) for preserving evidence, moving needed countermeasures, and retiring old consumers.
Those instructions predate explicit D-layer adoption: also apply the D-layer choice above, whether or not the catalog was already migrated.

### Repository-level work discipline leaves the distributed skills

The distributed skills no longer carry rules that each repository decides for itself ([ADR-0039](adr/0039-distribution-scope-by-provided-purpose.md), category iii).
After upgrading, three distributed files no longer carry such rules.
The examples below are not exhaustive.

- The pfd-ops work cycle (`references/work-cycle.md`) keeps only the PFD-specific contract. Removed rules include the comparison-target principle and its application points, fixing a baseline before measuring a change, checking that an existing mechanism actually observes the property it is named to guard, git hygiene in shared trees, delegation control, the generic terminal-gate items, and the split between machine-checked and human-checked items.
- The work-item backend presets (`references/github-issues-backend.md`, `references/file-based-tracker-backend.md`) no longer define the design-record format (Format 3), its reapproval-reference grammar, the commit steps that produce approval evidence, the commit granularity of a design record, or the scope rule for unrelated bug fixes.
- The pfd-retro skill no longer defines the execution contract of one audit run (run ID, cutoff, required sources, frozen inventory, and checkpoints). It now tells the auditor to check the pfd-retro binding for such a section before collecting sources.

The work cycle follows an optional `## ワークサイクルの追加手順` section of `.pfdsl/bindings/pfd-ops.md` in steps 1 to 3 when that section exists.
The current pfd-ops binding scaffold contains that heading, but a binding created from an earlier scaffold does not; add the heading yourself if you keep any rule there.

To see exactly what was removed, compare these three files between your installed release and the target release.
Ask the owner which removed rules to keep, and write the kept rules into the pfd-ops or pfd-retro binding in your own words.
Do not copy the upstream repository's own bindings wholesale: they contain that repository's decisions, not defaults.
If you keep none of them, no action is needed.
Source commits include `8dfd50f5`, `57de2d68`, `b2ed2450`, `f3f0dc4c`, `1ecbbb24`, and `6b031144`.

### Frontmatter types and declaration keys (FM004)

Known fields now enforce their declared types, including strings, numbers, arrays, and mappings.
Correct reported type errors using the current specification, preserving meaning rather than deleting metadata or converting every value to a string.

Keys in `artifact`, `process`, `group`, and `tag` declarations must be YAML strings.
Quote numeric, boolean, or null-like ID spellings, or use `!!str` where appropriate.
If earlier coercion may have collapsed distinct keys, compare the original source and history before restoring definitions or references; do not invent missing data.
See [specification history v0.0.23–v0.0.24](spec/spec-history.md), [#1272](https://github.com/takasek/pfdsl/issues/1272), and [#1290](https://github.com/takasek/pfdsl/issues/1290).

### Roadmap declarations and status (V035)

Roadmap artifacts used in body edges require frontmatter declarations and explicit status.
Add missing declarations and set status from actual progress, not merely to pass validation.
Update custom handling of the former W005 diagnostic to account for V035, which is an error even outside strict mode.

The status field describes the tree containing the file.
For PR-based work, a completed artifact's `done` update belongs in the completion PR; it need not wait for a post-merge update.
Review stale `wip` values against completion evidence before changing them.
If local instructions still defer `done` updates until after merging, update those instructions to include the status change in the completion PR.

### IDs beginning with a hyphen (L002)

A body ID beginning with `-` must use quoted-ID syntax.
Preserve the ID and check every reference when quoting it.
Do not apply a blanket replacement to hyphens: frontmatter delimiters and edge operators are unrelated syntax.

### Topological order (`meta sort --by topological`)

The topological order now places every producer before its consumers by graph rank.
Earlier releases ordered nodes by first appearance in the edge list, which could place a process after one that consumes its output.
A file sorted with v0.0.26 can therefore fail `pfdsl meta sort --by topological --check` after the upgrade, although nobody edited it.
The same order numbers nodes in `meta reindex`: the default run keeps existing `index:` values, but `--renumber` can assign different numbers than before.

If the repository runs `meta sort --by topological --check`, run `pfdsl meta sort --by topological --write` on each reported file, review the reordered declarations, and commit them.
Only declaration order changes; the graph does not.
Verify that the check passes afterwards.
Source commit: `6353f4c8`.

### Files reported as skipped on every deploy

This applies to repositories that deploy the GitHub Issues backend files (`.github/workflows/`, `scripts/pfdsl/`) with `check-install-sync.mjs --deploy`.

Symptom: the same files appear under `Skipped (locally modified; ...)` on every deploy, although nobody edited them.

Cause: installers before [#1314](https://github.com/takasek/pfdsl/pull/1314) wrote the new canonical hash into `.claude/pfd-ops-install-manifest.json` even for files they skipped.
The manifest then no longer describes the file on disk, and the current installer cannot tell that state from a local edit.
The current installer preserves a mismatched entry and does not repair it automatically.
Neither the manifest hash nor the latest canonical hash proves that the file is unedited.

Recovery compares each file's bytes with every version of that file in the upstream history.
An unedited distributed copy is byte-identical to some upstream version of the same path, whether that version was released or came from an untagged development or repository-local build.
Every step below preserves the files and the manifest until the comparison has finished.

1. Save the current manifest and list the candidate paths.
   The read-only check lists every file that differs from the bundled copy, which includes all skipped files and writes nothing.

   ```sh
   cp .claude/pfd-ops-install-manifest.json .claude/pfd-ops-install-manifest.json.before
   node <pfd-ops skill root>/scripts/check-install-sync.mjs --target .
   ```

   Copy the paths marked `different from bundled version` into the `for` line of step 3.

2. Clone the upstream history, including its tags, outside the adopting repository.

   ```sh
   UP="$(mktemp -d)/pfdsl.git"
   git clone --quiet --bare --filter=blob:none https://github.com/takasek/pfdsl.git "$UP"
   ```

3. Run the following from the adopting repository root, once per path from step 1.
   A deployed target path is the file's path below `install/`, so the upstream file is `.claude/skills/pfd-ops/install/<deployed path>` in every commit that touched it.
   The loop compares Git blob IDs, which identify the exact bytes, so it needs no file contents from the clone.
   The install directory moved to `scripts/pfdsl/` in v0.0.23 ([ADR-0032](adr/0032-pfd-ops-install-dedicated-dir.md)), so a current path only has history from that move on.

   ```sh
   for rel in scripts/pfdsl/lib/gh-exec.mjs scripts/pfdsl/lib/proxy-fetch.mjs; do
     want=$(git hash-object --no-filters "$rel")
     found=
     for c in $(git -C "$UP" log --all --full-history --format=%H -- ".claude/skills/pfd-ops/install/$rel"); do
       if [ "$(git -C "$UP" rev-parse -q --verify "$c:.claude/skills/pfd-ops/install/$rel" 2>/dev/null)" = "$want" ]; then
         found=$c
         break
       fi
     done
     if [ -n "$found" ]; then
       tag=$(git -C "$UP" tag --contains "$found" --list 'v[0-9]*' | sort -V | head -n 1)
       echo "$rel: match at $found (first release tag containing it: ${tag:-none})"
     else
       echo "$rel: NO MATCH"
     fi
   done
   ```

   Use a name other than `path` for the loop variable: in zsh it is tied to `PATH`.
   `--no-filters` hashes the bytes on disk, so a file whose line endings were converted does not match; treat that as a difference to inspect.

4. Decide from the result.
   A match means the file is byte-identical to that upstream version, so it carries no local edit.
   A match with `none` as the release tag is an unreleased upstream version, for example from a development build or a repository-local install.
   `NO MATCH` means the file differs from every version in the clone: it carries a local edit, or comes from a source that is not in the upstream history.
   Do not overwrite it; inspect the difference against the nearest version and carry the needed edits into the current file by hand.

5. Only if every listed path matched, redeploy with overwrite.
   The redeploy also adds the sweep workflow described in the next section; it does nothing until the repository enables it, but read that section before committing the deployed files.

   ```sh
   node <pfd-ops skill root>/scripts/check-install-sync.mjs --target . --deploy --overwrite-local-edits
   ```

   `--overwrite-local-edits` is not limited to one path: it overwrites every file that differs from the bundled copy, so a file you did not compare loses its edits.
   If any skipped path did not match, merge manually instead of using the flag.
   The overwrite rewrites the manifest entries for the files it copies, so the same files are no longer reported on the next deploy.
   Delete `.claude/pfd-ops-install-manifest.json.before` once the redeploy is reviewed.

The installer's ordinary deployment and orphan-handling options are documented in the [installer guidance](../.claude/skills/pfd-ops/references/architecture.md#配置ファイルの鮮度セルフチェック).

### GitHub Issues backend: new completed-chain sweep workflow

This applies to repositories that deploy the GitHub Issues backend files with `check-install-sync.mjs --deploy`.

Redeploying now adds a workflow and its script:

- `.github/workflows/pfdsl-sweep-completed-chains.yml`
- `scripts/pfdsl/sweep-completed-chains.mjs`, with the helpers `chain-sweep.mjs`, `cli-id-arg.mjs`, `ready-compare.mjs`, and `scratch-path.mjs` under `scripts/pfdsl/lib/`

The sweep is disabled unless the repository enables it in `.pfdsl/config.json` ([ADR-0042](adr/0042-adopter-config-file.md)):

```json
{"sweepCompletedChains": {"enabled": true}}
```

Deployed files have to be committed to reach the team and CI, so the workflow file itself is expected to be committed with the other deployed files.
Whether it acts is decided by that key, which the installer never overwrites.
Without the key, or with `enabled` set to anything other than the boolean `true`, each run checks out the repository, emits a notice that the sweep is disabled, and succeeds without doing anything else.
If `.pfdsl/config.json` is not valid JSON or the key has the wrong shape, the run fails and names the file, so a broken declaration does not silently stop the sweep.
Ask the repository owner whether to enable it, after settling the points below.

Behavior once enabled, from the workflow file:

- Trigger: every `push` to a branch other than `flow-sync/pending`, the sweep's own pull request branch. The job runs only when the pushed ref is the repository's default branch and does nothing otherwise.
- Action: it runs `node scripts/pfdsl/sweep-completed-chains.mjs .pfdsl/roadmap.pfdsl --write`, which removes chains whose artifacts are all done from the roadmap.
  When the roadmap changes, it opens a pull request from the branch `flow-sync/pending` titled `chore(plan): sweep completed chains`, touching only `.pfdsl/roadmap.pfdsl`. A person merges it.
- Permissions: the workflow requests `contents: write` and `pull-requests: write`.
- Concurrency: runs share the group `flow-sync`, and a run in progress is not cancelled by a newer one.

Points to settle before enabling:

- By default the pull request is created with `GITHUB_TOKEN`, so GitHub holds the repository's own `pull_request` workflow runs for it in an approval-required state (`action_required`) until someone with write access approves them.
  The pull request body says so, and that the sweep's own checks are the only verification it has received until then.
  If the default branch requires status checks, this pull request does not report them until those runs are approved.
  To have them start without approval, set the repository variable `PFDSL_SWEEP_APP_CLIENT_ID` and the secret `PFDSL_SWEEP_APP_PRIVATE_KEY` for a GitHub App installed on the repository with Contents and Pull requests write access.
  The workflow then opens the pull request with a short-lived token of that App.
  A repository without the variable keeps using `GITHUB_TOKEN`.
- Creating the pull request requires that the repository, and its organization if it restricts this, allows GitHub Actions to create pull requests (Settings, Actions, General, Workflow permissions).
  This setting is GitHub's requirement for the pull-request step; the workflow file does not check it.
  A rule that blocks creating the `flow-sync/pending` branch also blocks the step.
- The workflow installs the published `@pfdsl/cli` with an unpinned `npm install --no-save @pfdsl/cli`, and the sweep script stops at startup unless that CLI has the `delete` subcommand.
  `@pfdsl/cli` 0.0.26 and earlier lack `delete`; v0.1.0 is the first release that has it.
  Because the install is unpinned, the workflow uses whatever release the npm `latest` tag names when it runs.
- Once enabled, the script fails when `.pfdsl/roadmap.pfdsl` is missing or does not pass `check`, so enabling it in a repository without that file gives a failed run on every push to the default branch.
- Deployment copies files only; it does not install runtime dependencies (the installer prints this).
  The workflow itself needs no dependency beyond the published CLI above.
  The first audit and local runs of `audit-issues-flow.mjs` need the `yaml` package: follow the section 依存の準備と初回監査 in the [GitHub Issues backend reference](../.claude/skills/pfd-ops/references/github-issues-backend.md).

To stop a sweep that was enabled, set `enabled` to `false` or remove the key.
To also stop the workflow from starting at all, disable it on GitHub ([Disabling and enabling a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)); do not delete the deployed file, because the next deploy copies it again.

### Verify the cleanup

Validate affected diagrams with the intended CLI and run the repository's relevant checks.
Report the before/after diagnostics, changed files, inapplicable steps, and unresolved decisions.
Do not report an adopter as migrated until these checks have run there.

## Unreleased — after CLI/plugin v0.1.0

This section covers the changes after CLI/plugin v0.1.0 that need action in an adopting repository.
The destination release is assigned during release preparation; do not infer it.

### Record the applied migration state

pfd-ops now compares the running plugin with `appliedMigration` in the repository's `.pfdsl/config.json`: the plugin release the repository has finished migrating to ([ADR-0043](adr/0043-applied-migration-state.md)).
The comparison runs on every pfd-ops start (`check-install-sync.mjs`) in every repository that has a `.pfdsl/` directory, with or without `--upstream`, and it only reads the record.

Until the key exists, every run prints a notice that the repository predates migration-state tracking and points back to "Choosing the update range" above.
The notice is not a failure.

After you finish applying this guide, record the state once your checks pass (see "Verify the cleanup").
Run the following from the repository root, with the pfd-ops skill root of the plugin you are migrating to (`${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops` in Claude Code, the installed plugin's `skills/pfd-ops` in Codex):

```sh
node <pfd-ops skill root>/scripts/check-install-sync.mjs --record-migration
```

The command writes the running plugin's version, and its bundle hash where the plugin has one, into `.pfdsl/config.json` and keeps every other key.
Commit that change together with the migration it records.
It cannot be combined with `--deploy`, and it writes nothing, exiting with 3 after saying why, when the running plugin's version is unknown (a repo-local copy), when the plugin is older than the recorded state, or when `.pfdsl/config.json` is malformed.
You may write the key by hand, in the form `{"appliedMigration": {"pluginVersion": "0.1.0", "bundleHash": "<64 hex digits>"}}`, but the command computes the hash for you.
A Codex plugin has no bundle manifest, so its record has no `bundleHash`.

Once recorded, later runs say nothing while the plugin matches the record.
A newer plugin prints the range of this guide to read, which is the cue to migrate and record again.
A plugin older than the record is told to update, and `--deploy` and `--record-migration` are refused with exit 3 until it does, so an old `install/` cannot roll back files a newer release placed.
If `.pfdsl/config.json` is not valid JSON or has a malformed `appliedMigration`, the run fails naming the file instead of ignoring it.

Verify by running `check-install-sync.mjs` again: it prints no migration notice.
Source: [#1319](https://github.com/takasek/pfdsl/issues/1319).

## Maintaining this guide

This guide is maintained once, during release preparation, and not by an obligation on each change.
Release preparation lists every commit since the previous release tag that touched distributed files, classifies each as requiring adopter action or not, and has a maintainer confirm the classification.
For each commit that requires action, it writes an entry with the previous behavior, affected installations, action, verification, and source issue or commit.
It assigns the actual destination release and retains historical sections and their links.
Do not guess future release numbers or discard older instructions after publishing.
If an interval requires no action for a package family, record that all commits were classified and none required action in its release preparation record, rather than inventing cleanup steps.
Link the relevant section from release notes when release notes are produced.
The repository's [workflow procedure](../.pfdsl/workflow.md#採用先への移行案内) owns the commit listing command and the release review steps.
