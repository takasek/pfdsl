# Additional Linux diagnosis A / B / C — 2026-10-08 UTC

Dot returned another diagnosis of the fixed product source `8261f877d5cae8aa653a5310edfbd9e387acb116`.
This follows the [first Inspector diagnosis](../inspector-results/README.md); it does not replace its records or the original acceptance.
The 133-condition / 399-host-cell checklist is byte-for-byte unchanged: 202 passed, 3 historical failures, 7 unverified and 187 not applicable.
The parent recomputed the archive checksums, snapshot pixel counts, raw model values, settings comparisons and matrix totals.
Linux GUI execution and live settings inspection are dot's observations, not a parent rerun.

## Identity and evidence

Production remains [artifact 11461844652 / run 37574418253](https://github.com/takasek/pfdsl/actions/runs/37574418253/artifacts/11461844652).
The separate Inspector build remains [artifact 11525926292 / run 37720330151](https://github.com/takasek/pfdsl/actions/runs/37720330151/artifacts/11525926292).
Both report the same product source; the diagnostic native executable and bundled liblzma differ, so a production/diagnostic difference is not attributed solely to devtools.
Dot's preservation records identify the previously accepted outer/inner hashes, matching frontend 10/10 and unchanged manifests/fixtures, with normal application exits 0.
The submitted archive contains provenance and check logs, not duplicate AppImage payloads; the parent did not rehash or launch those payloads.

Submitted evidence ZIP is 4,517,604 bytes, SHA256 `ada89fd42747f47bca927002d7c106be1f302c16eef17a2eb81d7c36e168778b`.
The parent checked all 125 ZIP entries for safe paths, entry types, duplicates and CRC, then verified all 124 manifest files and the complete file set excluding the manifest itself.
The separately attached report exactly matches `REPORT.md` in the archive.
The retained checklist exactly matches the preceding Inspector archive's checklist.
Full reports, recordings, geometry, console captures, model JSON and settings records remain in the owner's archive.
[Parent audit](parent-audit.json) records the recomputed evidence and its limits.

## A: SVG CSS does not produce the expected visible cue

Dot first selected input/build in a normal session of the diagnostic AppImage, without opening Inspector, pausing a debugger or installing an observer.
The saved launcher identifies artifact 11525926292; this control is not an original-production-binary cue acceptance run.
The 80-second recording includes later Inspector use; only the initial control intervals are Inspector-free.
The submitted main-diagram ROI has zero strict-blue pixels in each 63-frame input/build interval.
Later static geometry was collected after cue removal, so it is not active-cue geometry or proof that all clipping was absent throughout the cue.
The previous class/selector/computed/timer observation remains a separate diagnostic record.

A separate GTK window loaded only an independent HTML/SVG fixture using the bundled WebKitGTK 2.54.0 runtime.
It did not load PFDSL or change product DOM/CSS, packages, sandbox or rendering flags.
Saved computed values show the requested blue outline/drop-shadow on SVG groups/shapes, including changing animation values.
The WebKit renderer snapshots show no blue for those cases, while a direct SVG rectangle stroke and HTML outline/shadow are positive controls.
The parent independently reproduced the submitted counts: SVG outline, group shadow, rectangle shadow and transformed animated group each 0; direct stroke 1,600; HTML control 2,960 blue pixels.
The snapshots scheduled at 400ms and 2000ms are byte-identical.

The original comparison images remain in the submitted archive as `minimal-repro/snapshot-400ms.png` and `minimal-repro/snapshot-2000ms.png`, with the SHA256 recorded in the parent audit.

This independent reproduction places the discrepancy before desktop capture and shows that permanent styles also fail to paint in this environment.
It narrows the investigation beyond merely missing the short cue, but does not identify PFDSL's particular paint, invalidation or compositor mechanism.
Active-cue Layers records and a PFDSL renderer-snapshot/desktop comparison were not completed.
The existing cue CSS in `packages/editor/src/preview-shell.ts` uses group outline/drop-shadow; explicit SVG shape stroke or an overlay is a repair candidate, not an implemented or accepted fix.
Any candidate must preserve existing shape/status/border styling and be tested on the normal app before Inspector/observer instrumentation, including target switching, redraw, zoom/transforms, clipping, minimap isolation and timed removal.
The original four native cue cells remain unverified.

## B: effective reduced motion is still an environment prerequisite

The X server identifies an active xfsettingsd publisher, but its reported PID does not identify that process in the reachable runtime.
The reachable xfconfd has a local bus/namespace identity and theme/font settings different from the active XSettings blob.
This supports a settings-route mismatch; the publisher's own namespace, bus and settings path were not directly obtained.
Native still reports `reduce=false`; effective GTK animations remain enabled.
Dot did not repeat the ineffective xfconf write or rebuild Code payloads without reaching `reduce=true`.

Dot reports zero settings writes.
The parent independently compared all eight saved baseline/final items: owner, owner properties, xfconf property/theme/font, GTK effective value, GNOME value/type/override existence and xfconf settings file; all match.
This is a no-change comparison, not a new restoration experiment, and does not recover the earlier missing historical baseline.
Acceptance needs access through the supported settings service of the actual desktop session, with baseline value/type/override existence known before the authorized animation-setting change.
The two reduced-motion cells remain unverified; manager replacement, direct XSettings writes or forced namespace access are not acceptance substitutes.

## C: debugger-assisted rendering errors remain separate from normal editing

Dot used the same CRLF fixture for production with no Inspector, diagnostic with no Inspector, and diagnostic with Inspector open but not paused.
Saved create/Undo/Redo images show normal editor content in those controls; the unpaused diagnostic Console captures show no errors.
Production's Console was unavailable, which is not proof that it contained no exceptions.

In the paused diagnostic control, dot reports Trusted Types `editorViewLayer` / `createHTML` errors before evaluating model getters.
The saved `evidence/C-paused-resumed-after.jpg` also shows missing editor text on lines 19–21; `C-paused-undo.jpg` and `C-paused-redo.jpg` show subsequent recovery.
The submitted report describes the missing text as a live observation, but a saved image supports that limited observation as well.
Neither the report nor those later images establish persistent blanking or the same failure in production.
The sequential controls do not completely eliminate operation-order/repetition confounding or identify the WebKit/Monaco callback mechanism.

Subsequent raw model reads are a different measurement interval.
The parent recomputed Undo as 481 bytes / 21 CRLF, Redo as 522 bytes / 24 CRLF, with zero lone LF and exact equality to the preceding raw JSON values/hashes.
The previous four raw states remain valid diagnostic evidence, not original-binary saved-byte acceptance or raw-model measurements of every new control.
C does not justify changing production model-editing logic or relaxing CSP.
If debugger compatibility needs a repair, a separate minimal WebKitGTK/Monaco Trusted Types reproduction is still required.

## Remaining work

A now has a concrete rendering fallback candidate and a normal-app verification plan.
B requires a supported route to the effective desktop setting before acceptance can continue.
C is a debugger-assisted observation with recovered paint, rather than a confirmed production regression.
This diagnostic attempt is complete, while the grouped acceptance and its seven unverified cells remain open, including same-process document disposal.
No product fix, new feature implementation, OS setting change or new GUI acceptance is performed by recording these results.
