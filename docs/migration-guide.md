# Migration guide

Use this guide when upgrading an existing pfdsl installation.
Release-specific cleanup instructions live here; distributed skills link here rather than retaining old migration rules.
Run applicable steps in the adopting repository, preserving local changes and following its approval rules.

## Changes after CLI/plugin v0.0.26

This section covers changes through upstream commit `dc94909e` (2026-09-29), including specification versions v0.0.22–v0.0.26.
CLI/package versions and specification versions are separate.
Confirm that your upgrade contains these changes; the released CLI tag v0.0.26 predates them, even if a development build reports the same package version.
These instructions do not claim that a newer package has been published.
For later revisions, also consult the [specification history](spec/spec-history.md).

Before editing, record the installed CLI/plugin identity, the affected files, and validation results with the intended upgrade.
Edit the adopting repository's sources, not plugin caches or generated distribution files.

### Optional knowledge lifecycle audit

The pfd-retro D layer now requires explicit adoption.
An old D heading or extra audit rules in `.pfdsl/bindings/pfd-retro.md` no longer enable it.

Ask the repository owner whether to continue this audit.
If continuing, add `知識成果物ライフサイクル監査: 採用する` and explicitly identify the artifacts to audit in that binding.
Do not infer the audit scope from descriptions or future plans.
If discontinuing, remove obsolete active D-layer instructions and links after checking their consumers; retain historical records and content needed by other audit layers.
See [ADR-0039](adr/0039-distribution-scope-by-provided-purpose.md) and [Issue #1275](https://github.com/takasek/pfdsl/issues/1275).

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

When a release changes accepted files or adopter workflows, add the affected versions, symptoms, cleanup steps, and verification here, and link the relevant section from its release notes.
Keep old procedures in this repository document; distributed skills only need a stable link to it.
