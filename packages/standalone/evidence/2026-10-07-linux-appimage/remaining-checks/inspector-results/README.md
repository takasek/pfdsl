# Linux Inspector results — 2026-10-08 UTC

The owner returned the separate Inspector diagnosis from dot's Debian 13.6 / x86_64 desktop.
This closes that diagnostic attempt, not the original grouped acceptance.
The original 133-condition / 399-host-cell checklist is byte-for-byte unchanged: 202 passed, 3 historical failures, 7 unverified and 187 not applicable.
The parent checked the submitted evidence and an independent reviewer inspected its primary records; neither performed a new Linux GUI run.

## Execution identity and preservation

Product source is `8261f877d5cae8aa653a5310edfbd9e387acb116`.
The separate release build with `tauri/devtools` is [artifact 11525926292 from run 37720330151](https://github.com/takasek/pfdsl/actions/runs/37720330151/artifacts/11525926292).
Its workflow PR HEAD is `4c4ad310fc9707693d0683f414cf23051821139b`; its immutable synthetic-merge workflow SHA is `2ccb6b93c135844661dfea95bf887411750fc740`.
The AppImage SHA256 is `700212eab2ca31bcb24eb9b865647d4190312e6667f313395782a9c534c3f425`, and the inner executable is `02fd853b3cc6c00d27f3e630bd0e65be30b8b6a042d2f7d7377d033775a8e761`.
The accepted executable and bundled liblzma differ from this build, as recorded by CI; diagnostic behavior is not attributed exclusively to the Inspector feature.

Submitted evidence ZIP is 9,979,503 bytes, SHA256 `7a6845f86334771ea2717ab75f2480e78a231b561124edb288bb7cc485217531`.
The parent verified safe paths and entry types, CRC, all 136 manifest files and the complete file set.
Dot's records show outer manifest 18/18, extracted AppDir regular files 304/304, all 380 AppDir entries unchanged after execution, matching frontend 10/10 and both locks, resolved native/GLES dependencies, unchanged fixtures/source, and native/extension-host exit 0.
The parent inspected these records without executing the AppImage on macOS.
The separately attached `pfdsl-1411-8261-remaining-checks-report.md` is the preceding report; the latest report is `pfdsl-1411-linux-inspector/report.md` inside this ZIP.
Private desktop/profile paths, full video and screenshots remain in the submitted archive.
[Parent audit](parent-audit.json) records the recomputed values and their proof limits.

## Native cue: computed state versus captured presentation

Normal Inspector access worked and reached the live Console and Sources/model scopes.
Elements/Computed usability was reported by dot without saved screenshots of those panes; computed properties are independently present in the saved observer records.
Cue observation ran before debugger breakpoints, with a read-only observer armed before the operations.
It collected 424 records, including 20 class records, 401 animation-frame samples and one SVG adoption.
Samples show connected, visible, opaque nodes with nonzero geometry, matching `.pfdsl-focus-cue`, a blue 2px outline, animated blue drop-shadow and `reduce=false`.
Removal occurs about 1.5 seconds after the last attachment; moving to another target removes the previous class.
MutationObserver delivery does not prove separate painted frames for same-task remove/add operations, and computed reads can add measurement overhead.

The 212.100-second, 30fps screen recording does not show the expected sustained blue cue.
The exposed input/build intervals contain 45/46 nominal frames; the submitted analysis finds no blue pixels, with 37 settled input frames identical to the post-cue reference and build differences at most 4/255 per channel.
The parent inspected the contact sheet, and the saved observer/analysis establish a mismatch between computed state and captured presentation.
Independent decoding also found no strict/weak blue in the settled input/build intervals and reproduced the 37 identical input frames.
Its build maximum differed slightly at 5/255 with two identical frames, versus the submitted Linux decoder's 4/255 with seven; the cue conclusion is unchanged, but exact build pixel metrics were not independently reproduced.
They do not identify SVG paint/filter support, invalidation, clipping, compositor or capture path as the root cause.
Presentation lag, H.264 sampling and partially occluded output/cursor-crossed done cases remain limitations; input/build are the clearest observations.
The original artifact's four cue cells remain unverified rather than being rewritten from this separate binary.

A normal meaning-preserving edit disconnected the old SVG and connected a new SVG at `07:05:15.211Z`, with zero cue elements and no subsequent reattachment before observation stopped.
This is direct diagnostic DOM-adoption evidence, not an original-binary visible-cue acceptance result or proof of same-process document disposal.

## Actual Monaco model: CRLF preserved

Sources reached the actual document-tab callback scope without assuming a global Monaco export.
The four JSON values came from `getEOL()` and `getValue()` before Create definition, after creation, after normal Undo and after Redo.
All retain CRLF, with no lone LF: 481 bytes / 21 CRLF before and after Undo, 522 bytes / 24 CRLF after creation and Redo.
The parent recomputed the values/hashes and confirmed before equals Undo and after equals Redo.
This resolves the model-read limitation for the diagnostic binary, outside the 399 cells; it does not prove original-binary saved bytes or editor painting.

During breakpoint-assisted definition/Undo inspection, the editor showed stale/blank lines and a Trusted Types `editorViewLayer` policy error lacking `createHTML`.
The saved scope/console evidence supports that observation, but no unpaused original-binary reproduction was performed.
Keep it as a separate unresolved diagnostic observation, not a confirmed regression of PR #1411.

## Reduced motion and restoration

Read-only inspection identified active `xfsettingsd 4.20.1`.
Before mutation, Gio recorded GNOME effective true/type b with no user override, and xfconf recorded no `/Gtk/EnableAnimations` property.
This current GNOME observation differs from the preceding attempt's explicit true; the evidence does not explain when or why it changed and does not recover the earlier missing baseline.
GNOME was not changed in this attempt.

Creating only the authorized xfconf animation property as false succeeded, but the active XSettings publisher's blob/serial remained unchanged immediately and about 196 seconds later.
Fresh GTK still reported animations=true, and both native and the actual PFDSL VS Code webview reported `reduce=false`.
Reachable xfconf settings and the active publisher differ, and the reported publisher PID was not found among the reachable bus connections.
This localizes a propagation boundary; it does not establish a particular bus/namespace or daemon fault.
The two original reduced-motion cells remain unverified because the effective test condition was never reached.

Reset removed only the newly created property.
The parent independently compared GNOME value/type/override existence, GTK effective value, XSettings owner/blob and the full xfconf map with the current baseline; all match.
Current-baseline restoration is complete for this attempt, while the preceding historical restoration remains unproven.
VS Code used matching official Code and five payloads in a new isolated profile, needed no trust change, and changed no modifier setting.
The newly created profile remains a diagnostic work directory; it was not restored to a nonexistent older profile.

## Remaining work boundaries

The next product investigation is a minimal native SVG/capture reproduction and a cue rendering fix verified on real WebKitGTK, with other shapes, transforms, status styling, minimap, timer and reduced-motion behavior covered.
An outline/filter replacement is a candidate, not an established implementation choice.
Environment work must separately identify a supported setting path that actually reaches the active publisher and both webviews; repeating the same ineffective write does not advance acceptance.
Normal native UI still provides no observed same-process individual-document disposal entry; shared preview/host-adapter tests remain separate evidence and no tab-close/Save UI is synthesized.
No source/runner changes, package installation, sandbox/rendering changes, issue/PR posting, issue close or merge were performed by dot.
