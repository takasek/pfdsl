# Preview editing evidence, 2026-10-05

This bundle supports the partial implementation of #1352, #1282, #1283, #1284 and #483.
The roadmap artifacts remain `wip`; this evidence does not certify complete native or owner acceptance.

| Evidence | Scope |
| --- | --- |
| [Validation](validation.json) | Final runtime source fingerprints, complete workspace tests, typecheck, native build/corpus and proof limits |
| [Blind browser and VS Code review](browser-review.md), [manifest](browser-evidence-manifest.json) | Frozen observations with distinct initial/final assets; all structured observations, fixtures and five selected screenshots are retained in `browser/` |
| [CLI experience](cli/initial-experience.md), [raw scenarios](cli/initial-experience.json) | Initial 28 built-CLI scenarios; its recovery-hint finding is historical and subsequently repaired |
| [CLI recovery re-review](cli/recovery-review.md), [built replay](cli/recovery-built.json) | Independent option-boundary counterexample and four actual POSIX shell copy executions after repair |
| [Browser exception before repair](browser-parent-recheck-before-fix.json), [after repair](browser-parent-recheck-after-fix.json) | Parent supplementary replay of quoted connectors/Undo, invalid and valid new IDs, and constructor definition; three iterations reproduced the exception before repair, three after repair have no pageerror and matching main/minimap node IDs |
| [Additional independent hover review](hover-additional-review.md) | Twelve producer/serialization/actual SVG/consumer cases on prototype-named semantic IDs, with explicit DOM and native proof boundaries |
| [Native build and Rust units](native-build-and-tests.txt), [initial corpus](native-corpus-report.json) | Initial binary `d005c101…`, two Rust tests and 23 native document comparisons |
| [Blind native review](native-gui-review.md), [structured report](native-gui-report.json), [AX observations](native-gui-ax.txt), [manifest](native-evidence-manifest.json) | Ordinary UI operations in binary `d005c101…`; direct-launch crash and ordinary-launch success, visible editor/minimap mismatch and unverified gestures remain explicit |
| [Final native build](native-final-build.txt), [corpus](native-final-corpus-report.json), [input fingerprints](native-final-baseline-fingerprints.json), [lifecycle](native-final-corpus-lifecycle.json) | Rebuilt binary `842cc46e…` includes the metadata/hover repair; 23 comparisons pass, failures/errors are empty, the owned process was terminated and waited for |

The browser exception was reproduced from actual pointer input over a node named `constructor`.
Absent tooltip metadata inherited `Object.prototype.constructor` and `.map` then failed.
The repair keeps authored prototype-named metadata in serialization and uses own-property lookups for descriptions, locations and subflows.
Regression tests cover `constructor`, `toString` and `__proto__` before and after authored metadata is supplied.
The independent additional review also exercises actual Graphviz SVGs and JSON message round trips; this is separate from native GUI acceptance.

Frontend fingerprints in native baselines describe build inputs, not independently extracted embedded assets.
The native executable fingerprint covers the bundled executable.
Corpus inputs are fixed snapshots; roadmap `updated_at` values were synchronized with GitHub afterward without changing runtime code or acceptance criteria.
The original temporary full logs/baselines retain the hashes listed here; this bundle contains summaries and selected evidence rather than all screenshots or expanded baseline models/SVGs.
Absolute user paths are normalized in saved independent reports; the manifests distinguish original and stored fingerprints.

The native editor's visible text and the final minimap differed from the updated main graph/AX source during the blind native run.
Their cause remains unresolved; browser agreement does not certify native agreement.
Native hover/pan/source cue/folder picker/window-close/IME, additional VS Code preview interactions, and owner UI acceptance remain pending.
