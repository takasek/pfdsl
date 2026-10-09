# Reduced motion on an independent virtual desktop

Dot executed the [separate OS-preference method](../next-method.md) on 2026-10-09 UTC.
The product source remains `151d39345c6945c3fe11a75f558068d011cbe197`, normal production artifact `11569256223` from run `37819347003`, attempt 1.
The method/session is `independent-xorg-dummy-20261009-display90`: a private Xorg dummy virtual desktop, 1364×1024, with isolated settings and application state.
The result is limited to that virtual desktop and recorded runtime; it does not repair or certify the original shared desktop's inaccessible publisher.

| Host | New-method result | Observed boundary |
| --- | --- | --- |
| Native | Passed with normal process restarts | Fade → static → fade; static cue disappears at approximately 1.5s; target switching, editing/Undo and baseline restoration verified |
| VS Code | Partial | Fade → static → fade after normal restarts, but the static cue remains approximately 2.03s in an uninterrupted build-target trial, outside the requested approximately 1.5s |

Both hosts continued fading in the tested live-setting-change trials.
Those live trials are retained as observations, not successful animation suppression.
The restart results do not prove that every environment requires a restart.
Neither production webview's direct `matchMedia` value was measured; the original direct-query tests remain unverified.

## Provenance and environment

The previous payload/checkout directories were unavailable, so dot obtained the same unexpired fixed artifact and a clean exact-source checkout.
Safe ZIP/tar extraction, outer 14/14 and AppDir 304/304 checksums, executable identity and local/artifact frontend 10/10 equality were confirmed again.
Setup/check/build succeeded with Node 24.19.0 and pnpm 10.33.2.
The fixed payload fingerprints are unchanged from the [production record](../README.md).

Xvfb and Xephyr were unavailable; existing Xorg 1.21.1.16 and its dummy driver supported an unprivileged private display.
The existing D-Bus 1.16.2, xfconf 4.20.0, xfsettingsd 4.20.1, GTK readers, FFmpeg 7.1.5 and XTEST input were used without installation or root.
Dot verified a vacant new display before starting its own publisher, process ownership, dedicated session bus/user state and X authentication; unauthenticated connections were rejected and TCP listening was disabled.
It used no manager replacement, direct XSettings write, forced namespace access or shared-profile/trust change.
The six normal production application sessions comprise three native processes and three isolated VS Code 1.140.0 Extension Development Hosts.
Actual X input and framebuffer recordings are distinct from DOM/jsdom, media emulation, Inspector/paused-debugger or diagnostic-binary evidence.

## OS preference and restoration

The normal xfconf animation setting, its private XSettings publisher and effective GTK value were linked before the comparison.
Only the private desktop's animation preference was changed through that settings route.

| Phase | xfconf override | XSettings animation entry | Effective GTK animation | GNOME value/type/user override |
| --- | --- | --- | --- | --- |
| Original baseline | Absent | Absent | true | true / boolean / absent |
| Test A | true, boolean | integer 1 | true | true / boolean / present |
| Test B | false, boolean | integer 0 | false | false / boolean / present |
| Return to test A | true, boolean | integer 1 | true | true / boolean / present |
| Exact final restoration | Absent | Absent | true | true / boolean / absent |

Some intermediate GNOME override records incorrectly serialized a false GLib Variant as null despite recording override existence.
Those records were retained; a corrected typed read confirmed the false boolean override, and the baseline/final absence comparison was independently checkable.
The final original value/type/override-existence restoration is separate from returning to the test's normal A phase.
The shared display's owner/blob and all nine scoped setting comparisons matched before/after; this is shared-session noninterference, not its repair.

## Recorded comparison and duration difference

Each host used the same fixture/target/viewport within its trials, at native 100% and VS Code 60.9%.
Native used ordinary editor input after an inconclusive folder-picker attempt; folder selection success is not claimed for this run.
Native restored its initial sample with Undo before normal close; VS Code used its ordinary semantic selection and preview command in Restricted Mode.
The fixed CSS was not modified.

| Recorded A/B/A phase | Cue-border RGB contrast at onset / 0.3 / 0.6 / 1.0 / 1.3s | Observed onset-to-first-absent / uncertainty interval |
| --- | --- | --- |
| Native A | 1.000 / 0.796 / 0.628 / 0.448 / 0.372 | 1.534s / 1.500–1.567s |
| Native B | 1.000 / 1.000 / 1.000 / 1.000 / 1.000 | 1.500s / 1.467–1.533s |
| Native restored test A | 1.000 / 0.796 / 0.622 / 0.448 / 0.370 | 1.500s / 1.466–1.534s |
| VS Code A | 1.000 / 0.802 / 0.630 / 0.456 / 0.373 | 1.500s / 1.467–1.533s |
| VS Code B | 1.000 / 1.000 / 1.000 / 1.000 / 1.000 | 2.033s / 2.000–2.067s |
| VS Code restored test A | 1.000 / 0.792 / 0.623 / 0.458 / 0.375 | 1.533s / 1.500–1.567s |

Contrast is normalized RGB difference in the cue's geometric border band from the same trial's cleared frame; it is not a direct opacity API value.
Times use decoded presentation timestamps, not nominal frame indices.
The ordinary phases fade, the restarted B phases have constant cue pixels, and the restored ordinary phases fade again.
Native's initial A and live restored A also contain a one-frame strong-color rebound immediately before disappearance; that observation is retained and its cause is not assigned.
VS Code B's uninterrupted build trial has no intervening target input.
A separate target-switch segment retains a static output cue beyond 1.8s but overlaps later edit input at its endpoint, so it is not used to prove natural expiry.

The shared product source requests a 1500ms timer; the screen observation does not establish its actual callback time or the origin of the VS Code delay.
Do not attribute the difference to a timer, duplicate navigation, event loop, compositor or recorder without distinguishing those layers.
Keep VS Code's complete new-method condition partial and preserve the uninterrupted trial as the reproduction reference for a focused timing investigation.
Animation suppression itself is supported in both restarted hosts; that narrower fact does not erase the duration mismatch.

## Evidence, preservation and applicability

The five original ZIPs, report, six untranscoded source recordings and settings/timing/frame evidence are retained privately.
[Audit index](audit.json) identifies their hashes, 412 evidence-file checksums, trial metrics, condition statuses and selected original evidence fingerprints.
The parent checks archive CRC/path/type/duplicate consistency and manifests, without executing attached scripts or rerunning the Linux GUI.
An independent reviewer redecoded 75 frames in each of six A/B/A trials, matched all 78 selected PNGs to the source RGB frames, and confirmed the static VS Code B cue at PTS 84.067 through 86.067s, absent at 86.100s.
The reviewer separately checked baseline restoration, the three shared-setting comparison points, target switching/editing and final document/PR claims; no required correction remains.
Product payload bytes are not attached here; their preservation is supported by dot's supplied identity/manifest records and correspondence to the previously verified fixed artifact.

All six app sessions ended normally with exit 0.
Recorder SIGINT finalization produced exit 255 and is distinguished from app exit.
The owned private desktop/session processes and sockets were absent after teardown; not every daemon's numeric wait status was collected.
Original baseline, shared nine comparisons, fixture, artifact and prior evidence were preserved.
Native chooser, missing session/system services and VS Code update warnings remain recorded rather than being declared absent or assigned a cause.

The old 30-row production checklist, direct-query results, shared B_PUBLISHER blocker and 133-condition / 399-cell `8261f877` matrix remain unchanged.
Native I1284-021 disposal was not tested and retains its normal-path resumption condition.
Corpus, raw CRLF and paused Inspector observations are not replaced by this result.
This update records an executed method; it changes no product source/runner or UI and certifies no whole issue, macOS or other distribution.
