# Fixed-source production cue verification

Dot verified source `151d39345c6945c3fe11a75f558068d011cbe197` on its Linux x86_64 desktop on 2026-10-08 UTC.
This is a separate production run after the [HTML cue change](../cue-candidate.md), not a rewrite of the fixed `8261f877` acceptance matrix.
The new 30-condition checklist has **26 passes, 3 unverified conditions and 1 blocked environment prerequisite**.
There is no product failure recorded in this checklist; unverified conditions are not certified as successful.
The corpus result is separately 23/23 and does not fill GUI evidence gaps.

## Identity and retained evidence

The normal production [desktop artifact 11569256223](https://github.com/takasek/pfdsl/actions/runs/37819347003/artifacts/11569256223) came from run `37819347003`, attempt 1.
Its name is `pfdsl-linux-appimage-x64-151d39345c6945c3fe11a75f558068d011cbe197-attempt-1`.

| Payload | SHA256 |
| --- | --- |
| ZIP, 119,956,948 bytes | `081b9a84e6fa70b2ad84970ee12065d73d62fd3fbcab2085624fa51315a67f42` |
| PFDSL.AppImage | `8331bf28b5a21c8522186581b8d8a6dbd3e6c3b73e9e9f85eac801070ab7cc6b` |
| Inner native executable | `513bce5c1fcf93ee32bf9b4fef1a668d1adb2d5676f41ebfede0ca45a4eaf70e` |

Dot checked provenance, safe extraction, SOURCE_COMMIT, 0755 executable modes, outer 14/14 and AppDir 304/304 checksums and native/GLES runtime dependencies.
Exact-source setup/build succeeded with Node 24.19.0 and pnpm 10.33.2; the artifact and local frontend sets and all 10 hashes matched.
The parent compared the supplied frontend fingerprints with its previously downloaded production payload and obtained the same 10 hashes.
The separate VS Code 1.140.0 Extension Development Host used the same checkout and an isolated profile, retaining Restricted Mode.

The owner's original report and four evidence archives are retained outside the repository.
[Parent audit](audit.json) identifies their hashes, checksum counts, condition statuses and selected evidence fingerprints without publishing private session paths or recordings.
The parent checked ZIP CRCs, paths/types, duplicate consistency, all 195 listed evidence-file checksums, all 30 condition evidence links, corpus identity/results and the supplied preservation records.
Attached scripts were not executed.
The parent and independent reviewer assess recorded evidence; they do not claim another Linux GUI run.

## Normal GUI result

Native I1284-014 through I1284-017 passed through ordinary neighborhood clicks and editor node navigation.
The target-only outer rectangle was visibly painted, removed after approximately 1.5 seconds, replaced on A-to-B navigation and not retriggered by tested ordinary redraw/editing.
The main recording began before AppRun, with no Inspector, paused debugger, DOM/style mutation, media emulation or webview observation script.

| Recorded sequence | First / last visible frame, seconds | Inclusive duration at 30fps |
| --- | --- | --- |
| Native hover to input | 115.8000 / 117.2333 | 1.467s |
| Native editor to build | 136.6000 / 138.0667 | 1.500s |
| Native rapid navigation to output B | 150.2333 / 151.7000 | 1.500s |
| VS Code editor to input | 253.8667 / 255.3333 | 1.500s |
| VS Code hover to build | 282.4000 / 283.8333 | 1.467s |

Native A and B input calls were 0.258s apart.
A was visible around 150.0s; B remained visible at 151.6s, beyond A's approximately 151.5s expiry, and was absent at 151.7333s.
These are video-relative observations with capture/processing uncertainty, not exact internal timer callback measurements.
Frame geometry, comparison to a cleared baseline and full-frame inspection distinguish the transient cue from authored dashed borders, minimap viewport rectangles and VS Code's persistent keyboard focus outline.

Tested native Fit levels 77.7% and 32.7%, 100%, zoom to/from 110%, pan, a fully visible edge target and long labels retained cue alignment and original status colors/dashed borders.
Normal off-viewport clipping is not counted as a cue defect.
No target cue appeared in the minimap or unrelated main nodes in the tested sequences.
Node actions, Help, label editing and Undo/Redo remained usable.
Normal Create definition/Undo/Redo rendered inserted/restored text without a persistent blank editor; this does not establish live-model CRLF bytes in the new version.
A separate recorded repeat established the initial run's inconclusive 100% physical hover click and active-cue zoom-in.
Limited same-source VS Code editor/hover cues, expiry, zoom/minimap and label Undo/Redo also passed.

## Remaining prerequisites and proof limits

| New condition | Status | Missing evidence / next prerequisite |
| --- | --- | --- |
| B_PUBLISHER | Blocked | A supported connection to the settings service for the actual active desktop publisher, or action and baseline capture by that session's owner |
| B_NATIVE_REDUCE | Unverified | The supported setting route and a normal read-only production webview query proving reduce=true before behavior and exact restoration checks |
| B_CODE_REDUCE | Unverified | Its own effective PFDSL webview query and a supported actual preference source before behavior checks; no profile/media emulation substitute |
| I1284-021 native | Unverified | An existing normal per-document close/dispose UI route; whole-process exit, restart, tab switching and programmatic disposal do not prove this condition |

The readable settings service could not be linked to the active XSettings publisher: its exposed theme/font differed and the publisher PID was absent from the readable process namespace.
This establishes a missing verified settings route, not the publisher's internal namespace/bus or a product propagation failure.
There were zero settings writes, and all nine scoped before/after settings comparisons matched.
No setting-toggle/restoration success is claimed, and GTK's current animation value is not substituted for either production webview's media query.
Repeating the same inaccessible setting route or normal process restart would not close these conditions; obtain the prerequisites before further verification.
No extra UI, manager replacement, direct XSettings write, forced namespace access or package installation was introduced.

The normal native UI exposed no individual document disposal entry in this source.
This result does not remove or reclassify the old condition.
The old fixed `8261f877` 133-condition / 399-host-cell matrix remains **202 passed, 3 historical failures, 7 unverified and 187 not applicable**.
Old raw CRLF and paused Inspector/Trusted Types observations are retained as separate diagnostics, not rerun or promoted into new production success.
The grouped five issues are not certified as wholly complete.

## Preservation and review

The final supplied checks retain outer 14/14, AppDir 304/304, ZIP/AppImage/inner hashes, the three fixture originals and previous evidence.
Native, its separate 23-document corpus and the isolated Extension Development Host exited normally with exit 0; final task-process checks were empty.
Recorder exit 255 followed normal SIGINT finalization and is not reported as an app failure.
Native normal/corpus stderr was empty; VS Code's environment/update/GPU warnings remain in the original logs rather than being declared absent or causal.
Source/runner edits, OS installation, sandbox/render flag changes, general-profile/trust changes, issue close and merge were not performed by dot.

This repository update only records returned evidence.
Its independent final review covers evidence claims and their consumers (review viewpoints 1/2); it chooses no new product design or user behavior, so viewpoints 3/4 do not newly trigger for this documentation update.
The reviewer independently decoded the original recordings, confirmed the five cue periods and B's surviving frame, and found no cue in the tested 120-frame ordinary redraw/edit interval.
The reviewer also recomputed all nine settings comparisons and checked the old full matrix, corpus, selected fingerprints and final document/PR claims; no required correction remained.
The product payload is not included in these returned evidence ZIPs, so the review checks its supplied identity/manifest records and frontend correspondence rather than independently rehashing a newly supplied AppImage or inner executable.
The earlier independent local-browser scenario remains an unperformed attempt; dot's executed scenarios are separately identified and do not retroactively convert it into a completed blind review.
The production GUI evidence is limited to the recorded Linux environment, exact artifact and listed inputs; macOS IME/shortcuts, formal distribution and other distros are not certified.
