# Source-close diagnostics

After the normal extension build, set `PFDSL_SMOKE_DIAGNOSTICS_DIR` to a new private directory and run the existing smoke entrypoint.
For example, `PFDSL_SMOKE_DIAGNOSTICS_DIR=/tmp/pfdsl-close-investigation make test-vscode-smoke` enables observation without changing the scenario, close target, predicate, timeout, or retry policy.
The usual launch arguments still apply.

Diagnostics use a separate extension root inside the issued run directory.
Only that bundle instruments the ten current extension `showTextDocument` call sites.
The ordinary extension bundle and product sources remain untouched.
The emitted `trace/show-sites.json` records the compiled call sites.
The transformation currently recognizes literal `vscode.window.showTextDocument(...)` calls; aliases or computed access require extending it and its coverage test.

Each `close-N.json` contains the physical DOM groups and tabs, close-button rectangle, pointer/click targets and coordinates, focus, visible workbench dialogs and notifications, DOM tab removal/addition events, and an independent extension-host tab-model trace.
Extension tracing begins at extension module loading, before the scenario's earlier interactions.
Source-open requests and their settlements include call-site identity and timestamps.
Save, document, tab-group and tab-change events help distinguish disk contents from model dirty state.
The clicked `.last()` source locator is unchanged; DOM diagnostics enumerate the other tabs independently.
The DOM and extension snapshots are asynchronous observations, not an atomic joint snapshot.
OS-native dialogs are outside this coverage.

Renderer and extension traces retain at most 64 and 128 events respectively, with overflow counters.
There is no synchronous per-event file logging.
Extension capture uses a filesystem request after the original close predicate settles or fails.
Renderer and extension snapshot collection is best effort and bounded; `unavailable`, dropped-event, or setup/capture-error records must be considered before interpreting an absent event.
Promise observers return the original thenable and preserve its fulfillment/rejection for callers, but attaching rejection observers changes unhandled-rejection reporting at existing unawaited call sites.
The instrumented build can affect timing and is not evidence of an unchanged failure frequency.
Compare uninstrumented and instrumented runs using the same source, executable and launch conditions.

Failed launches and failed scenarios preserve the isolated fixture and profile logs in a reported evidence directory before cleanup.
Evidence copies finish before cleanup can remove their source; they have no cancellation deadline.
Cleanup stops the spawned VS Code process, copies final logs after shutdown when an evidence path is available, and removes the issued run directory only after preservation succeeds.
If preservation fails, cleanup reports and retains the issued directory.
A renderer trace whose setup completes after its snapshot deadline is detached on late completion by its own instance identity, including when it overlaps a later close.
Successful diagnostic runs also retain evidence in the requested directory.
Preservation failures remain diagnostics rather than replacing the original failure.
Evidence may contain fixture paths and source text; keep the directory private.

A passing diagnostic run validates integration only.
It does not establish the intermittent close failure's cause or show that issue #1424 is fixed.
