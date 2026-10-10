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
