# Native app independent experience review

実行した通常 native アプリの Node actions、定義作成、label 編集、接続追加、Undo/Redo、tab 分離、エラー復帰、zoom は、下記の観測範囲で確認できた。
mouse/hover/pan、editor の可視文字の更新、folder picker、通常の window close は未確認を残す。

## Target and evidence boundary

- App: `packages/standalone/src-tauri/target/debug/bundle/macos/PFDSL.app` in the assigned checkout.
- Binary SHA-256: `d005c101d6154b81f7fdcc7eabd0d73ed0e2f940100f723f98268224d3c620b2`. Before/after fingerprints match.
- Ordinary app PID: `70217`, obtained through documented native `cua.getApp`.
- Disposable corpus: `<native-gui-review>/corpus`.
- Implementation source, final diff, design records and existing ACCEPTANCE conclusions were not read. No Git metadata or external publication was performed.
- Frontend build-input fingerprints are preserved in `fingerprints.json` and the JSON report. They are the 10 preparation-baseline input files. Tauri embeds frontend assets in the binary; no independent embedded-asset extraction was performed. The binary hash covers the bundled executable.

## Observed operations

| Scenario | Observed result | Evidence |
|---|---|---|
| Undefined process `draft` | Node actions offered Create definition. Definition and default label appeared; one Undo removed the entire definition; one Redo restored it. | 04-definition-created.ax.txt, 04-definition-created.png, 05-definition-undo.ax.txt |
| Label edit | `Draft document` appeared in editor AX source and rendered node. One Undo restored `draft`; one Redo restored the edited label. | 06-label-edited.ax.txt, 06-label-edited.png, 07-label-undo.ax.txt |
| New/Existing input | `new_brief >> draft` / `reserve >> draft` appeared in actual native editor AX source. | 08-input-new.ax.txt, 09-input-existing.ax.txt |
| New/Existing feedback | `new_notes >>? draft` / `manuscript >>? draft` appeared in actual native editor AX source. | 10-feedback-new.ax.txt, 11-feedback-existing.ax.txt |
| New/Existing output | `draft -> new_result` / `draft -> reserve` appeared in editor source. Fit screenshot shows branches to manuscript and reserve. | 12-output-new.ax.txt, 13-output-existing.ax.txt, 14-output-fit.png |
| Tab separation | Separate tab retained its source and 110% zoom; Welcome retained its edited source and 68.5% zoom when switched back. Both directions observed. | 15-tab-two.ax.txt, 16-tab-one-restored.ax.txt |
| Normal → Error → Normal | FM002 appeared, diagram actions were disabled; valid source restored the raw→refine→final graph and enabled controls. | 17–19 recovery evidence |
| Large graph zoom | 71 node buttons were observed. Fit became 6.2%; 100% showed readable middle chain nodes. | 20-large-fit.ax.txt/png, 21-final-raised.ax.txt/png |

The actual malformed-YAML message was:

```text
FM002: Invalid YAML in front matter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 12:

artifact: [
           ^
```

## Unverified and unresolved observations

Coordinate click and scroll returned `Computer Use server error -10005: noWindowsAvailable`. PID70217 remained alive and exact-app reacquisition returned its AX tree. Hover neighborhood, SVG neighbor movement/cue, mouse pan, minimap pointer navigation and double-click source navigation remain unverified. The error is recorded as an automation/window-acquisition failure, not a certified product failure.

Editor-position keyboard movement did select `process: draft` for Node actions. An editor-to-preview visual cue was not certified.

The native Open folder dialog reached `Where: corpus` but `Open` stayed disabled, and its AX column contents were empty. Both pasted and setValue path entry were attempted. The dialog was canceled; fresh fixture text was pasted into the newly launched app's built-in tabs. Native folder listing remains unverified.

App screenshots repeatedly showed stale Monaco visible text while editor AX source, diagram and minimap updated. Examples are initial Welcome text beside the changed Native action review graph, and Separate tab text beside the recovered Recovery exercise graph. The documented AX Raise operation was performed and the mismatch remained. The cause cannot be separated between native capture/compositing and user-visible product rendering with available evidence. Full visual editor rendering is therefore not certified.

Cmd+Q exited the dirty test app with no confirmation observed by CUA. The window-close button path was not tested; safe ordinary window close remains unverified. IME composition/commit was not exercised.

## Startup and cleanup

The initial direct executable launch through Python subprocess.Popen used PID70127 and matched the supplied crash at 2026-10-05 13:56:48 +0900, 0.197 seconds after launch. It was EXC_CRASH SIGABRT in Thread0: HIServices ___RegisterApplication → AppKit NSApplication sharedApplication → tao eventloop initialization → tauriBuilder.run, with LaunchServicesDatabase context. This direct method was not repeated. No device UUID, crash reporter key or incident identifier is retained here.

The documented native app acquisition route opened ordinary PFDSL UI successfully in PID70217. Actual executable path matched the assigned .app.

Only the trial app was quit. `ps` readback for PID70127 and PID70217 returned no process. All four corpus files retain their original SHA-256. No user document, other app, sibling trial process or checkout source file was changed. Evidence is retained in this directory.

## Durable evidence mapping

This is a path-normalized copy of the frozen independent review. The original review conclusions are unchanged. Original AX filenames in the table identify sections of [native-gui-ax.txt](native-gui-ax.txt). Retained image filenames use the `native-gui-` prefix, as listed in [native-evidence-manifest.json](native-evidence-manifest.json). Unselected screenshots remain in the temporary frozen review and are not claimed as durable attachments.

## Evidence review clarification

The final large-graph observation shows the main diagram updated to Large native pan exercise while the minimap still shows the previous Recovery exercise graph. Both the [final screenshot](native-gui-21-final-raised.png) and the final `21-final-raised.ax.txt` section of [native-gui-ax.txt](native-gui-ax.txt) contain this discrepancy; the `20-large-fit.ax.txt` section also retains the previous minimap text. The earlier frozen wording about changed minimap content does not certify continuous minimap synchronization. Visible editor rendering and minimap synchronization both remain unverified. This clarification preserves the frozen original review and states the narrower evidence boundary.
