# Preview editing evidence, 2026-10-05

This bundle supports the partial implementation of #1352, #1282, #1283, #1284 and #483.
The roadmap artifacts remain `wip`; this evidence does not certify complete native or owner acceptance.

| Evidence | Scope |
| --- | --- |
| [Validation](validation.json) | Frozen `dd5df03f` runtime source fingerprints, complete workspace tests, typecheck, native build/corpus and proof limits |
| [Blind browser and VS Code review](browser-review.md), [manifest](browser-evidence-manifest.json) | Frozen observations with distinct initial/final assets; all structured observations, fixtures and five selected screenshots are retained in `browser/` |
| [CLI experience](cli/initial-experience.md), [raw scenarios](cli/initial-experience.json) | Initial 28 built-CLI scenarios; its recovery-hint finding is historical and subsequently repaired |
| [CLI recovery re-review](cli/recovery-review.md), [built replay](cli/recovery-built.json) | Independent option-boundary counterexample and four actual POSIX shell copy executions after repair |
| [Browser exception before repair](browser-parent-recheck-before-fix.json), [after repair](browser-parent-recheck-after-fix.json) | Parent supplementary replay of quoted connectors/Undo, invalid and valid new IDs, and constructor definition; three iterations reproduced the exception before repair, three after repair have no pageerror and matching main/minimap node IDs |
| [Additional independent hover review](hover-additional-review.md) | Twelve producer/serialization/actual SVG/consumer cases on prototype-named semantic IDs, with explicit DOM and native proof boundaries |
| [Native build and Rust units](native-build-and-tests.txt), [initial corpus](native-corpus-report.json) | Initial binary `d005c101…`, two Rust tests and 23 native document comparisons |
| [Blind native review](native-gui-review.md), [structured report](native-gui-report.json), [AX observations](native-gui-ax.txt), [manifest](native-evidence-manifest.json) | Ordinary UI operations in binary `d005c101…`; direct-launch crash and ordinary-launch success, visible editor/minimap mismatch and unverified gestures remain explicit |
| [Final native build](native-final-build.txt), [corpus](native-final-corpus-report.json), [input fingerprints](native-final-baseline-fingerprints.json), [lifecycle](native-final-corpus-lifecycle.json) | Rebuilt binary `842cc46e…` includes the metadata/hover repair; 23 comparisons pass, failures/errors are empty, the owned process was terminated and waited for |
| [Display synchronization replay](display-sync-parent.json) | Parent transcription: native mismatch reproduced in `842cc46e…`, the same small source replay matches in `e0a697fa…`, and paused-frame/hidden-tab regression checks fail before repair and pass afterward |
| [Display synchronization review](display-sync-review.md), [structured report](display-sync-review.json) | Independent first-stage review: nine maintained regression checks and five actual Monaco/Graphviz browser cases, with animation frames deliberately paused |
| [Blind native synchronization recheck](native-display-recheck-report.md), [structured report](native-display-recheck-report.json), [manifest](native-display-recheck-manifest.json) | Frozen `e0a697fa…` run: short source/main/minimap now agree, but Cmd+Up leaves the current document's tail visible; this additional viewport Red precedes the final scheduler repair |
| [Browser viewport Red](browser-scroll-red.json), [event timing](browser-scroll-event-timing.json), [final independent review](browser-scroll-review.md), [Green](browser-scroll-green.json), [manifest](browser-scroll-manifest.json) | Actual production browser with stopped frames: cursor/reveal timing counterexample, then four successful Cmd+Up/Down, selection/collapse and wheel cases on asset `202275cb…`; coalescing/dispose are static checks |
| [Independent synchronization design](display-sync-design-review.md), [baseline](display-sync-design-baseline.json), [adoption review](display-sync-adoption-review.md) | Static derivation from four selected files in unmodified `origin/main d1fd7d87`, followed by a separate final-source/installed-Monaco comparison; callback limits and arbitrary automatic-layout conditions were not additionally measured |
| [Final blind native viewport recheck](native-scroll-recheck-report.md), [structured report](native-scroll-recheck-report.json), [manifest](native-scroll-recheck-manifest.json) | Binary `68a76bae…`: same-fixture Cmd+Up repaints the top and caret on the immediately following capture without a tab/Raise repair; short source identity and later tab return also match |
| [Final synchronization checks](display-sync-final-checks.json), [corpus](display-sync-final-corpus.json), [fingerprints](display-sync-final-fingerprints.json), [lifecycle](display-sync-final-lifecycle.json) | Final source/build/typecheck/standalone results and 23/23 native comparisons on `68a76bae…`; owned process was terminated and waited for |

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
That observation belongs to the frozen binaries above.
The later display synchronization repair and native replay are recorded separately; browser agreement alone does not certify native agreement.
The final native recheck resolves the reproduced content/minimap mismatch and the additional Cmd+Up viewport lag in those scenarios.
It does not measure the physical first compositor frame, independently establish OS foreground state, or certify every tiny minimap label's legibility.
The OS/automation cause of frame suspension is not established.
Native hover/pan/source cue/folder picker/window-close/IME, additional VS Code preview interactions, and owner UI acceptance remain pending.
