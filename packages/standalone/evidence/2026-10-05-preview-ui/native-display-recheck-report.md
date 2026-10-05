# Native display recheck — 2026-10-05

The focused ordinary native run confirms new-source display for short replacement, preview definition/label editing, large replacement, and tab return on binary `e0a697fa4007ee13831bc79f4285264fc244048bd72f76d6ee4d23c57831a5a9`.
A source cursor/viewport navigation discrepancy remains and is not a passing navigation scenario.
This report is scoped to the rebuilt binary and does not overwrite the frozen earlier review.

## Execution and independence

The app was launched through `cua.getApp(full .app path)` after the parent quit its own trial app.
The app path was `<checkout>/packages/standalone/src-tauri/target/debug/bundle/macos/PFDSL.app`; the executable was `Contents/MacOS/pfdsl-desktop` and owned PID was `84454`.
The executable SHA-256 matched before and after the run.
No native acceptance environment or direct subprocess launch was used.
Implementation source, diff, and design were not read during this review.
Only synthetic texts in this trial window were changed.
Cmd+Q reported `Computer Use server error -10005: App quit`; a narrow process query returned exit 1 and no output for PID 84454.

## Separate observations

| Scenario | AX source | Visible editor | Main SVG | Minimap |
| --- | --- | --- | --- | --- |
| Short replacement | Exact fixture | New title on line 2 and flow on line 4 | New title and raw → refine → final | Same title and three-node graph |
| Single Undo/Redo | Original Japanese / exact short | Corresponding source on both captures | Corresponding original / short graph | Corresponding original / short graph |
| Format and its Undo/Redo | Extra / canonical spaces after refresh | Corresponding spaces on line 4 | Same graph | Same graph |
| Create definition and label edit | artifact.raw.label raw / Raw source | Inserted definition and selected label | Box gains corresponding second label | Corresponding second label |
| Label single Undo/Redo | raw / Raw source | Corresponding label | Corresponding label | Corresponding label |
| Large replacement | Current Large top/tail fragments; 71 unique node IDs | Current Large body, then header/body on tab return | Whole chain at Fit6.2%; readable central nodes at100% | Long chain shape and current Large AX title/IDs |
| Tab returns | Each tab's current source | Each tab's current title/body | Large6.2% then100%; second short110% | Corresponding long / short shape |

The large fixture contains seed, 35 step nodes, and 35 artifact nodes.
A programmatic count of the saved full AX tree found exactly those 71 node buttons.
The large editor AX text is a caret-centered fragment and is not a whole-source dump.
The whole chain and minimap are too small to read every label visually at Fit6.2%.
At100%, the main capture shows title `Large native pan exercise` and the central step_17 → artifact_17 → step_18 → artifact_18 → step_19 segment.

## Navigation and AX limits

After Cmd+Up on the large document, AX exposes the current Large beginning while the visible editor remains at the current Large tail, lines 15–41, with a current-line box on line 41 in the saved image.
The reviewer recorded a caret on line 41 during the sequential observation; the retained image does not independently establish the caret position.
The reviewer also recorded the Window menu item `PFDSL` with `makeKeyAndOrderFront:` and selected it without a viewport refresh.
That menu/action identity is a sequential observation record, not independently recoverable from the retained screenshots or AX excerpts.
Tab away and back subsequently displays the current Large beginning.
The tail belongs to the current document; it is not retained text from the preceding short document.
This is a concrete cursor/viewport discrepancy under CUA, with product versus foreground/tool cause unassigned.
No Raise action was used as proof of visible-source correctness.
No independent OS frontmost identity was established.

Immediate Format and Undo AX snapshots retained the previous spacing while the screenshot showed changed spacing.
Editor focus refreshed Format AX, and a subsequent Up key refreshed Undo AX.
AX alone is therefore insufficient for immediate spacing assertions.
An AX click on SVG Node refine did not move keyboard focus; Return inserted a blank editor line, which a single Undo removed.
The toolbar Node actions route was usable and supplied the successful preview edit.

## Evidence

- [Structured observations and execution boundary](native-display-recheck-report.json)
- [All 26 full AX snapshots](native-display-recheck-ax.txt)
- [Short source and matching preview](native-display-recheck-02-short.png)
- [Formatted visible source](native-display-recheck-06-formatted.png)
- [Preview label edit](native-display-recheck-14-preview-label.png)
- [Navigation discrepancy after regular Window menu route](native-display-recheck-20-window-item.png)
- [Current Large beginning on tab return with Fit6.2%](native-display-recheck-23-large-return.png)
- [Current Large at100%](native-display-recheck-24-large-hundred.png)
- [Second tab return at110%](native-display-recheck-25-second-return.png)
- [Short fixture](native-display-recheck-short-fixture.pfdsl.txt), [large fixture](native-display-recheck-large-fixture.pfdsl.txt), [second-tab fixture](native-display-recheck-second-fixture.pfdsl.txt)

This focused run does not certify coordinate hover/drag/pan, native IME, file picker, disk save/reopen, connector variants, error recovery, or the full regression corpus.
Earlier coordinate `noWindowsAvailable` and stale-source observations remain in their frozen run with their original binary hash.
