# Source-close snapshots

The existing PR smoke job enables snapshots only for `codex/issue-1424-close-trace`.
`PFDSL_SMOKE_DIAGNOSTICS_DIR` selects the output directory; an empty or absent value leaves the ordinary smoke path unchanged.
Each close captures the targeted locator, tab labels, physical parent group indices and rectangles, DOM dirty hints, focus and visible workbench dialogs before the click, after its promise returns, and after the existing wait succeeds or fails.
The final `result` snapshot corresponds to the existing workbench log's `after` or `failed` phase.
Each JSON has a corresponding workbench screenshot when capture succeeds; capture errors are warnings in the job log.
Only these JSON/PNG files from the isolated smoke fixture are uploaded.
The extension build, single click, readiness checks, wait predicate/timeout and cleanup are unchanged.

These are asynchronous point-in-time observations, not an event trace.
They do not record the actual pointer target/coordinates, extension-host events or OS-native dialogs, and can miss a close followed by a reopen between snapshots.
Group indices identify current physical parents only and may change when a group is removed; tab labels alone do not identify a parent.
Labels are clipped to 160 characters and collections are bounded, while screenshots show the workbench viewport.
Screenshots and snapshot writes add latency when enabled, so passing captures do not establish the original failure cause or failure frequency.
Playwright tracing over the existing CDP connection is not validated or added in this revision.

When enabled, the ordinary preview creation also logs standard VS Code tab events for that source only.
The runner subscribes to console messages before opening the preview and saves projected fields in `close-tab-events.json`, covered by the existing artifact allowlist.
No source text, URI, tab label or raw console decoration is retained in that file.
Each `tabs` record is one callback containing its `opened` and `closed` view-column arrays; order between those arrays is unspecified, and view columns are not persistent group identifiers.
`startObserved` and `sequenceContinuous` identify the received start and callback sequence; invalid messages make the sequence unverified.
`sourceEndObserved` requires an intact start/callback sequence and a natural panel-disposal marker with its final sequence; stopping the receiver is not a producer acknowledgement.
Each panel has an opaque random producer ID; mixed producers or starts, reordered phases, sequence gaps or invalid records leave the end unverified.
These flags describe received callback evidence rather than guaranteed coverage of internal editor mutations.
Normal smoke cleanup may provide no disposal marker, so `tailUnverified` remains true and a missing close event cannot establish that no close occurred.
These callback and receive times can support observed close/reopen evidence, but do not establish internal mutation time, document disposal, failure frequency or the original failure cause.
