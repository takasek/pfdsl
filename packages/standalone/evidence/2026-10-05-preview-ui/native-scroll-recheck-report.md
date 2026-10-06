# Native scroll recheck — 2026-10-05

The exact current Large Cmd+Up case no longer reproduces the stale viewport discrepancy in this focused ordinary native run.
The next screenshot after the key shows source line 1 and a visible caret at column 1 before the opening `---`, while AX exposes the same source beginning.
No tab change, Window menu, Raise, activation, or other repair was performed before that capture.
The prior `e0a697…` report remains frozen with its original navigation discrepancy.

## Execution

The app was launched through `cua.getApp(full .app path)` from `<checkout>/packages/standalone/src-tauri/target/debug/bundle/macos/PFDSL.app` after the parent quit its own app.
The executable `Contents/MacOS/pfdsl-desktop` measured SHA-256 `68a76bae1ff661517f48cbfdd07ca115fd4c9fa2b547de7cbfcf985b5c1e7a29` before and after the run.
Owned PID was `70623`.
Cmd+Q reported `Computer Use server error -10005: App quit`; a narrow process query then returned exit 1 with no output for that PID.
No implementation source, diff, or design was read, and only synthetic texts in this app window were changed.

## Before and after

| Observation | Before Cmd+Up | Immediate next capture after one Cmd+Up |
| --- | --- | --- |
| AX source | Tail fragment from current Large document, ending at artifact_35 | Beginning of the same Large source, including title/layout/header and first body lines |
| Visible source | Current Large tail, lines 15–41; partly clipped line 14 | Current Large beginning, lines 1–32; title on line 2 and first flow on line 6 |
| Visible caret | Column 1 on empty line 41 | Column 1 on line 1 before opening `---` |
| Main SVG | Current Large chain at100% | Current Large chain at100% |
| Minimap | Current very small long-chain shape | Same current long-chain shape; AX retains current title and71 IDs |

The Large fixture is byte-identical to the prior replay: SHA-256 `df31c828012b30c62a503753d677497b0a3e4c0010b5d7192e49483389f06ef8`.
It has seed, 35 step nodes, and 35 artifact nodes.
The saved after-key AX tree contains exactly those 71 unique node buttons.
The long AX source is a caret-centered fragment and is not a full-source dump or guaranteed viewport representation.
The visible before/after source and caret are established by separate full-window screenshots.

## Display agreement and limits

Before the Large replay, the short Foreground redraw test replacement showed the same new source/title in AX, visible editor, main SVG, and minimap.
A Welcome → Japanese tab round trip was performed only after the successful immediate Cmd+Up capture.
Welcome showed its original source and corresponding short diagram/minimap; return showed the current Large beginning and100% with the current long graph/minimap.
No remaining discrepancy was observed in these focused checks.

The next AX/screenshot request followed immediately after `pressKey` resolved and used the tool automatic capture wait.
This does not measure the first animation frame or stopped-frame timing inside the renderer.
No independent OS frontmost identity was established.
The Large minimap is too small to read all labels visually; AX title/IDs provide separate semantic evidence.
This replay does not certify full corpus, connector variants, preview edits, Format/Undo/Redo, coordinate hover/drag/pan, IME, file picker, save/reopen, or error recovery.

## Evidence

- [Structured observations and capture timestamps](native-scroll-recheck-report.json)
- [Six full AX snapshots](native-scroll-recheck-ax.txt)
- [Short source/main/minimap identity](native-scroll-recheck-02-short.png)
- [Before Cmd+Up](native-scroll-recheck-03-before-cmd-up.png)
- [Immediate next capture after Cmd+Up](native-scroll-recheck-04-immediately-after-cmd-up.png)
- [Other tab](native-scroll-recheck-05-other-tab.png)
- [Later Large tab return](native-scroll-recheck-06-large-tab-return.png)
- [Short fixture](native-scroll-recheck-short-fixture.pfdsl.txt), [same Large fixture](native-scroll-recheck-large-fixture.pfdsl.txt)
