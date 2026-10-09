# Remaining-condition disposition and next method

This records the 2026-10-09 follow-up decision after the [production verification](README.md).
It does not change the 30-condition result or the fixed `8261f877` 399-cell matrix, and is not another executed verification.
The owner authorized progressing the setting-route prerequisites and deciding the disposition of the unavailable native disposal scenario.

## Native disposal

[Issue #1284](https://github.com/takasek/pfdsl/issues/1284) requires mount-local lifetimes and rejection of stale work after disposal.
It does not request a new individual-tab close UI.
The normal standalone main entry activates documents and handles whole-window close, but has no individual document/preview disposal action.
The document adapter does implement disposal; its pending-snapshot checks and the shared preview's delayed-render/cue checks remain valid automated evidence.
Their jsdom/Monaco seam does not establish native Monaco/Tauri behavior.

Keep native I1284-021 unverified, rather than removing it, making it not applicable or certifying it from tab switching/process restart.
Resume the native scenario in a version that introduces a normal same-process document/preview disposal path, with old hover/cue/pending work present and another surviving or subsequent document observed.
Do not add a testing-only UI or repeatedly send the unavailable scenario to dot.
This decides the handling of the condition; it does not complete the condition or close the issue.

## Reduced-motion evidence

The issue requests animation suppression through the OS setting; it does not require a direct production `matchMedia` read.
The earlier verification plan required that read and remains unverified under that method.
A separate method may establish the original behavior requirement through a genuine effective desktop preference and a recorded **normal → reduce → restored normal** comparison in each actual host.
Use the same product artifact, input, target, viewport and rendering conditions for all phases.
Confirm normal opacity change, a static reduced-motion cue with its ordinary expiry/navigation/editing behavior, and resumed opacity change after returning to the test's normal setting.
Then, in a separate final step, restore the original baseline value, type and override existence exactly.
If that original baseline was reduced motion, the final restoration must be static; it is not the normal phase of the comparison.
An unread production media query must remain explicitly unread; do not certify the earlier direct-query test as successful.
Setting values alone, a single still image or recordings with no discernible normal animation are insufficient.
Theme, renderer or input changes must not confound the preference comparison.

The [Xfce setting daemon](https://docs.xfce.org/xfce/xfce4-settings/xfsettingsd) applies xfconf settings through XSETTINGS to GTK and other desktop components.
Read-only correspondence of the service, active publisher and effective GTK preference is needed before attributing the app's recorded response to the OS change.
Direct production query evidence can additionally strengthen the comparison where an existing normal read-only entry is available.
Do not introduce media emulation, product DOM/style changes or a diagnostic binary as a substitute.

## Environment choices

| Method | Boundary |
| --- | --- |
| Existing desktop owner uses the actual supported settings service | Most direct way to verify the old desktop itself; requires that owner and exact baseline/restoration evidence |
| Temporary desktop using only already installed tools | Selected conditional next attempt; its success applies to its new DISPLAY/session/runtime, not the old shared desktop |
| Install packages or create a different external desktop | Outside this request; if installed capabilities are missing, report those prerequisites |

The conditional dot request first checks for an existing separate X server, private session bus/settings daemons, real screen capture/input and normal AppRun/Code execution.
A [private D-Bus session](https://dbus.freedesktop.org/doc/dbus-run-session.1.html) is a documented testing mechanism, but does not by itself isolate files or external services.
Require private configuration/cache/runtime/X authentication, verified process ownership and actual separate DISPLAY/bus use; stop if configuration writes or service activation can reach the shared session.
Start a settings publisher only on a new display with no existing owner.
No shared `:0` manager replacement, root access, package installation, authentication bypass, network exposure, direct XSettings writes or forced namespace access is allowed.
Animation changes are confined to that private desktop's normal settings service, with baseline value/type/override existence and exact restoration.
The existing shared desktop's owner/blob and nine settings comparisons must stay unchanged.

If only a virtual X display is available, record actual application rendering/input on that virtual desktop as such; do not promote it into a physical-screen or old-session result.
If any prerequisite is unavailable, report the precise missing capability once and stop this branch without repeating the ineffective shared-session writes.
Keep the original production artifact/source/frontend identities; the already successful cue/corpus suite does not need a full repeat.

An independent reviewer checked the issue, native main/adapter/preview and existing tests, then compared the environment choices and evidence methods.
The disposal decision and conditional private-desktop method preserve the original requirement and proof limits.
At this method's selection, environment preparation and the new comparison had not run.
The [2026-10-09 returned virtual-desktop result](reduced-motion/README.md) subsequently verifies native and records the VS Code visible-expiry difference separately, without changing the original method's statuses.
This documentation chooses no new product UI or source behavior.
