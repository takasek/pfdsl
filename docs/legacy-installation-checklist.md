# Legacy installation checklist

This historical handoff accompanies [PR #1317](https://github.com/takasek/pfdsl/pull/1317).
The owner may give it to existing adopting repositories once to establish a baseline for the migration guide.
It is not part of the normal upgrade route or an ongoing maintenance checklist.
This is a list of known inspection points, not proof that every historical residue has been enumerated.
Routine upgrades after that baseline use the guide's installed-to-target version interval.
Keep unresolved findings in the adopting repository's existing work records; do not repeat the entire checklist on every upgrade.

## Preserve and inventory

- Record the actual CLI, bundle, installation method, source revision, and local overrides; a shared version string does not establish identical contents.
- Preserve uncommitted changes, local rules, cases, and unresolved decisions before replacing or deleting anything.
- Inspect local skills, commands, agents, hooks, workflows, scripts, bindings, and their callers. Include files outside the install manifest and user-level copies only within the owner's authorized scope.
- Use Git history and the old bundle, where available, to distinguish distributed copies from adopter-owned work. A matching filename alone is not grounds for deletion.
- If origin or ownership cannot be established, record the uncertainty and leave the file in place until it can be resolved.

## Known residue checks

| Area | What to look for | Treatment and evidence |
| --- | --- | --- |
| Old skill installation | Repo-local copies or callers left from `pfdsl skill sync`, manual copying, or installation alongside a plugin | Compare discovery paths and actual loaded files, transfer local changes, and retire only confirmed duplicate consumers. See [ADR-0028](adr/0028-plugin-first-pfd-ops-distribution.md). |
| Deployed scripts and workflows | Older paths outside `scripts/pfdsl/`, renamed workflows, callers that still use them, or duplicate workflow triggers | Compare the old deployment to the current bundle and inspect callers before removal. Preserve adopter-specific logic; see [ADR-0032](adr/0032-pfd-ops-install-dedicated-dir.md). |
| Install manifest mismatch | A prior deploy reported `Skipped`, but recorded the new canonical hash while leaving an old file on disk | Follow the recovery steps below; the manifest alone cannot prove that the file is unedited. |
| Retro catalogs and rules | Tag-driven mandatory reading, 40-case/40-KB search thresholds, deleting cases only after mechanization, or old G6 notification paths | Follow [#1177](https://github.com/takasek/pfdsl/issues/1177) and [ADR-0038](adr/0038-retro-case-migration.md): preserve evidence, transfer needed countermeasures, then retire old consumers. Do not remove unrelated tests, reviews, hooks, or all bindings. Also apply the current D-layer adoption decision in the migration guide. |
| Old CLI calls | `graph` used for rendering, `normalize`, flat graph queries, `get`, `sort-meta`, `reindex`, `status-set`, `ready`, `audit-sync`, `check --audit`, `check --summary`, or `fmt --mode` | Inspect executable callers and active instructions, then translate according to [specification v0.0.17 history](spec/spec-history.md). Do not replace command words globally in historical records. |
| Old diagram values | `type: runtime-pipeline`, `status: blocked`, or status on non-roadmap diagrams | Consult the current specification. Distinguish external waiting from voluntary suspension and preserve actual progress; do not mechanically assign a single replacement state. Confirm whether progress belongs in a roadmap before removing it from a flow. |
| Validation assumptions | CI expecting ordinary `check` to reject conditions that are now warnings, feedback-only processes, or custom parsing of diagnostics and graph output | Review the validator's actual exit status and diagnostics under the intended CLI. Use strict validation where the project's acceptance criteria require it; do not invent normal inputs just to suppress W008. See [specification history](spec/spec-history.md). |

## Recover an old skipped-deployment manifest

Older deployments could leave an old file on disk while recording the new canonical hash in `.claude/pfd-ops-install-manifest.json`.
The current installer cannot distinguish that state from a local edit and does not automatically repair it.
Preserve the affected files and manifest, then compare each actual file's SHA-256 with the same file in the bundle that was originally deployed.
Neither the mismatched manifest nor the latest canonical hash proves the absence of local edits.

Only after confirming that every file the overwrite operation would affect is unedited may the owner use `--deploy --overwrite-local-edits` for that same target under the repository's approval rules.
This flag is not limited to one path: check other skipped files as well.
If the old bundle is unavailable or hashes differ, do not use the flag; inspect the differences and carry forward necessary local edits manually.
The current installer's ordinary deployment and orphan-handling options remain documented in the [installer guidance](../.claude/skills/pfd-ops/references/architecture.md#配置ファイルの鮮度セルフチェック).

## Close the baseline

Run the adopter's existing checks and exercise affected callers after the cleanup.
Confirm that needed rules still reach their operational steps, retired callers no longer run, and historical evidence remains retrievable.
Record the checked installation/revision, coverage, changes, inapplicable items, and unresolved findings in the adopter's existing records.
This baseline is local to that repository: publication of this checklist or closure of an upstream issue does not prove any adopter is clean.

Future version-specific changes belong in the migration guide.
Track unresolved findings from this one-time cleanup in each adopting repository rather than extending this historical checklist for routine upgrades.
