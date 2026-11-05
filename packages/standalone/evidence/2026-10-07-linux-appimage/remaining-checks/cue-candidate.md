# Candidate for the next native cue verification

This follows the [additional A/B/C diagnosis](abc-results/README.md).
The candidate changes shared preview rendering; it is not another acceptance run of the fixed `8261f877` artifact.
The original 133-condition / 399-host-cell evidence remains unchanged at 202 passed, 3 historical failures, 7 unverified and 187 not applicable.

## Rendering choice

The candidate draws a temporary HTML outline beside the SVG inside `#inner`.
It uses the node's screen bounds relative to `#inner`, converted back through the current scale.
Both elements then share the existing pan/zoom transform.
The outline is noninteractive and hidden from accessibility, uses the existing focus color, and disappears after 1500ms.
Its opacity animation is disabled by effective `prefers-reduced-motion: reduce`.
The original node's shapes, status colors, dashed lines and labels are not changed.
Minimap and export consume SVG or source data rather than the HTML decoration.

| Candidate | Reason for selection or rejection |
| --- | --- |
| HTML outline beside SVG | The independent WebKitGTK fixture paints HTML outlines; a sibling avoids SVG group outline/shadow and keeps the original SVG untouched |
| Extra SVG rectangle with stroke | The fixture paints direct strokes, but an SVG decoration adds viewBox clipping and clone-removal boundaries |
| Thick stroke on cloned node shapes | Follows node contours but adds handling for compound shapes, duplicated IDs and overlap with existing border styles |
| Keep group outline/shadow | The supplied independent fixture does not paint those styles in the target runtime |

A separate reviewer derived the alternatives from an unchanged `origin/main` tree before inspecting the candidate.
Final quality, correctness and adoption-rationale review found no required correction.
Regression tests failed before implementation because the HTML decoration was absent, then passed after implementation.
The shared editor's 237 tests pass; they cover coordinate conversion at 100% and 50%, original SVG attributes, minimap isolation, zoom, replacement, redraw, disposal and the 1499/1500ms boundary.
These are DOM/lifecycle checks, not proof of native painting or OS settings propagation.

## Production verification result

The [fixed-source production record](production-151d393/README.md) reports dot's normal AppImage verification of `151d39345c6945c3fe11a75f558068d011cbe197` on 2026-10-08 UTC.
Its separate 30-condition checklist has 26 passes, 3 unverified conditions and 1 blocked environment prerequisite.
Native I1284-014 through I1284-017, tested geometry/style/editing regressions and limited VS Code actions passed; the separate native corpus passed 23/23.
Effective reduced motion in both GUIs and normal per-document native disposal remain unverified.
The fixed `8261f877` matrix is unchanged.

## Verification boundaries

Use a new normal production AppImage built from the candidate's exact source commit, with repository/run/artifact/manifest/frontend identity verified again.
Do not use an Inspector build or mutate product DOM/styles to stand in for acceptance.
Verify visible cues through neighborhood clicks and normal editor navigation, rapid target replacement, timed removal, redraw, zoom/pan and viewport-edge cases.
Check that the minimap and original status/border styling remain intact, and exercise an existing editing/Undo/Redo route.

Reduced-motion acceptance remains a separate branch of the work.
First reach the supported settings service for the actual desktop session and record the baseline value/type/override existence.
The owner's prior permission covers a temporary animation-setting change followed by exact restoration; it does not cover replacing the settings manager, direct XSettings writes or forcing namespace access.
If that route is unavailable, report the missing environment capability and continue the independent normal-motion cue checks.
The original direct-query method also required a normal read-only way to inspect the target production webview's media query before changing settings.
If that query was unavailable, its condition stayed unverified; an old diagnostic binary's value does not prove this production binary's preference.
The [follow-up decision](production-151d393/next-method.md) specifies a separate normal/reduce/restored-normal recording method for the original behavior requirement; it does not certify the earlier direct-query test or rewrite its result.
Do not repeat the paused Inspector/Trusted Types diagnosis as part of this cue acceptance.

Before the dot run, an attempted independent local browser scenario could not start because no browser surface was connected to the automation API.
Dot subsequently supplied normal GUI cue and geometry evidence; the parent and independent reviewer inspect that evidence rather than rerunning the Linux GUI.
The earlier direct-query method remains unverified; the separate behavior comparison for the original reduced-motion requirement follows the supported-setting prerequisites in [next-method.md](production-151d393/next-method.md).
The existing same-process document-disposal cell also remains unverified unless a normal UI path is available; a whole-process restart is not that proof.
