# Migration guide

Use this guide when upgrading an existing pfdsl installation.
Release-specific cleanup instructions live here; distributed skills link here rather than retaining old migration rules.
Run applicable steps in the adopting repository, preserving local changes and following its approval rules.

## Choosing the update range

Record both the installed and target CLI/plugin releases, including the bundle revision when package versions alone are ambiguous.
Read the entries introduced after the installed release and through the target release, in release order; skip entries outside that interval.
Changing a version number alone is not evidence that old local copies have been cleaned up.

## Unreleased — after CLI/plugin v0.0.26

This section covers changes through upstream commit `dc94909e` (2026-09-29), including specification versions v0.0.22–v0.0.26, and the D-layer declaration syntax that was changed after that commit ([ADR-0041](adr/0041-retro-d-layer-declaration-token.md)).
CLI/package versions and specification versions are separate.
Confirm that your upgrade contains these changes; the released CLI tag v0.0.26 predates them, even if a development build reports the same package version.
These instructions do not claim that a newer package has been published.
The destination release is not yet assigned; do not infer one from the specification version.
Release preparation must verify the full interval through its target commit and assign the destination release before publication.
The [specification history](spec/spec-history.md) provides additional technical context, not a substitute for this guide's CLI and workflow migration coverage.

Before editing, record the installed CLI/plugin identity, the affected files, and validation results with the intended upgrade.
Edit the adopting repository's sources, not plugin caches or generated distribution files.

### Optional knowledge lifecycle audit

The pfd-retro D layer now requires an explicit declaration.
An old D heading or extra audit rules in `.pfdsl/bindings/pfd-retro.md` no longer enable it.
The former Japanese declaration line (`知識成果物ライフサイクル監査: 採用する`) is not recognized.

Ask the repository owner whether to continue this audit, then put exactly one of these lines at the start of a line in that binding:

- `knowledge-lifecycle-audit: adopt` — continue the audit, and explicitly identify the artifacts to audit in the same binding section.
- `knowledge-lifecycle-audit: decline` — stop the audit; retro neither audits nor reports the D layer.

Until one of these lines exists, retro does not audit the D layer and reports on every run that the owner must declare `adopt` or `decline`.
A duplicated line or an invalid value is reported the same way, naming which problem it is.
Do not infer the audit scope from descriptions or future plans.
If declining, remove obsolete active D-layer instructions and links after checking their consumers; retain historical records and content needed by other audit layers.
See [ADR-0039](adr/0039-distribution-scope-by-provided-purpose.md), [ADR-0041](adr/0041-retro-d-layer-declaration-token.md), and [Issue #1275](https://github.com/takasek/pfdsl/issues/1275).

### Retro catalog retirement

This interval also retires the former retro catalog and its dedicated notification paths.
Follow [the retro binding migration instructions in #1177](https://github.com/takasek/pfdsl/issues/1177) for preserving evidence, moving needed countermeasures, and retiring old consumers.
Those instructions predate explicit D-layer adoption: also apply the D-layer choice above, whether or not the catalog was already migrated.

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
   The redeploy also adds the sweep workflow described in the next section, so read that section first.

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

Behavior, from the workflow file:

- Trigger: every `push`. The job runs only when the pushed ref is the repository's default branch and does nothing otherwise.
- Action: it runs `node scripts/pfdsl/sweep-completed-chains.mjs .pfdsl/roadmap.pfdsl --write`, which removes chains whose artifacts are all done from the roadmap.
  When the roadmap changes, it opens a pull request from the branch `flow-sync/pending` titled `chore(plan): sweep completed chains`, touching only `.pfdsl/roadmap.pfdsl`. A person merges it.
- Permissions: the workflow requests `contents: write` and `pull-requests: write`.
- Concurrency: runs share the group `flow-sync`, and a run in progress is not cancelled by a newer one.

Points to settle before redeploying:

- The pull request is created with `GITHUB_TOKEN`, so GitHub does not start the repository's own `pull_request` workflows for it.
  The pull request body says the sweep's own checks are the only verification it received.
  If the default branch requires status checks, this pull request will not report them until you trigger them by your own means.
- Creating the pull request requires that the repository, and its organization if it restricts this, allows GitHub Actions to create pull requests (Settings, Actions, General, Workflow permissions).
  This setting is GitHub's requirement for the pull-request step; the workflow file does not check it.
  A rule that blocks creating the `flow-sync/pending` branch also blocks the step.
- The workflow installs the published `@pfdsl/cli` with an unpinned `npm install --no-save @pfdsl/cli`, and the sweep script stops at startup unless that CLI has the `delete` subcommand.
  The script's own startup check records that `@pfdsl/cli` 0.0.26 and earlier lack `delete`, and the npm `latest` tag was still 0.0.26 on 2026-09-30.
  Until a release that includes `delete` is published, each run on the default branch of an adopting repository ends with that startup error.
  Confirm which `@pfdsl/cli` release the workflow would resolve before you commit the deployed files.
- The script fails when `.pfdsl/roadmap.pfdsl` is missing or does not pass `check`, so a repository without that file gets a failed run on every push to the default branch.
- Deployment copies files only; it does not install runtime dependencies (the installer prints this).
  The workflow itself needs no dependency beyond the published CLI above.
  The first audit and local runs of `audit-issues-flow.mjs` need the `yaml` package: follow the section 依存の準備と初回監査 in the [GitHub Issues backend reference](../.claude/skills/pfd-ops/references/github-issues-backend.md).

Opt-out: neither the installer nor the workflow file has a switch. The installer has no option to skip a file, the workflow has no input or variable that disables it, and a deleted deployed file is copied again by the next deploy.
A locally edited copy is preserved as a `Skipped` file on later deploys.

There are two ways to keep it from running:

- Disable the workflow on GitHub, from the repository's Actions tab ("Disable workflow") or with `gh workflow disable pfdsl-sweep-completed-chains.yml`.
  GitHub documents that this stops the workflow from being triggered without deleting the file ([Disabling and enabling a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)).
  The file itself is unchanged, and the documentation does not say where the disabled state is kept, so confirm the workflow is still disabled after a later redeploy.
- Do not commit the deployed workflow file. Its job runs only for a push to the default branch, so it does nothing until the file is committed there; leaving it uncommitted, or removing it before committing, keeps it from running.
  Because a deploy copies it again whenever it is missing, repeat this after each redeploy.

### Verify the cleanup

Validate affected diagrams with the intended CLI and run the repository's relevant checks.
Report the before/after diagnostics, changed files, inapplicable steps, and unresolved decisions.
Do not report an adopter as migrated until these checks have run there.

## Maintaining this guide

This guide is maintained once, during release preparation, and not by an obligation on each change.
Release preparation lists every commit since the previous release tag that touched distributed files, classifies each as requiring adopter action or not, and has a maintainer confirm the classification.
For each commit that requires action, it writes an entry with the previous behavior, affected installations, action, verification, and source issue or commit.
It assigns the actual destination release and retains historical sections and their links.
Do not guess future release numbers or discard older instructions after publishing.
If an interval requires no action for a package family, record that all commits were classified and none required action in its release preparation record, rather than inventing cleanup steps.
Link the relevant section from release notes when release notes are produced.
The repository's [workflow procedure](../.pfdsl/workflow.md#採用先への移行案内) owns the commit listing command and the release review steps.
