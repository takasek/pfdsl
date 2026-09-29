# Migration guide

Use this guide when upgrading an existing pfdsl installation.
Release-specific cleanup instructions live here; distributed skills link here rather than retaining old migration rules.
Run applicable steps in the adopting repository, preserving local changes and following its approval rules.

## Choosing the update range

Record both the installed and target CLI/plugin releases, including the bundle revision when package versions alone are ambiguous.
Read the entries introduced after the installed release and through the target release, in release order; skip entries outside that interval.
Changing a version number alone is not evidence that old local copies have been cleaned up.

## Unreleased — after CLI/plugin v0.0.26

This section covers changes through upstream commit `dc94909e` (2026-09-29), including specification versions v0.0.22–v0.0.26.
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

### Verify the cleanup

Validate affected diagrams with the intended CLI and run the repository's relevant checks.
Report the before/after diagnostics, changed files, inapplicable steps, and unresolved decisions.
Do not report an adopter as migrated until these checks have run there.

## Maintaining this guide

Contributors add migration-relevant changes as unreleased entries in the change PR, including the previous behavior, affected installations, action, verification, and source issue or commit.
Release preparation checks the complete previous-release-to-target interval, assigns the actual destination release, and retains historical sections and their links.
Do not guess future release numbers or discard older instructions after publishing.
If an interval requires no action for a package family, record that conclusion in its release preparation record rather than inventing cleanup steps.
Link the relevant section from release notes when release notes are produced.
The repository's [workflow procedure](../.pfdsl/workflow.md#採用先への移行案内) owns the maintenance and release review steps.
