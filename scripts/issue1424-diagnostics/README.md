# Source-tab close diagnostics

This job observes issue #1424 on the original synthetic merge `526e17c070bb1447ebf3f74192db2fef391b60a8`.
It runs the original full smoke sequence, with VS Code 1.132.1, Node 24.21.0, pnpm 10.33.2, and Xvfb on Ubuntu 24.04.
The original download, launch arguments, close predicates, deadlines, and scenario order are retained.
The fixed checkout basename and VS Code cache restore key/path match the original failing job.
The hosted runner image is recorded because its contents can change independently of the source revision.

The workflow runs three independent trials, once each, on changes to this diagnostic on the existing PR branch.
It does not retry a failed operation or turn a failed smoke into a passing job.
Successful diagnostic trials do not establish a fix, failure frequency, or equivalence to the historical runner image.
Synchronous API logging and DOM checkpoints can change timing.

The first observation-only run, 37910383184, produced two successful trials and one failure on the first Close.
Its failed click reached the Close button before the API save event; no tab closure or later PFDSL reopen request was recorded.
The historical issue failed on the second Close, so the two failures are not assumed to have the same cause.
The current job is explicitly labeled `save-completion` and adds one precondition before each of the two saved-source closes.
It retains the existing disk-content checks and waits for a save event matching the current document version, with the document and tab both clean in the latest API snapshot.
This is a diagnostic comparison, not an unmodified trial or a shipped fix.
The tab's visual dirty class alone is insufficient as a save-completion assertion: VS Code also hides it while saving.
Missing API evidence fails the precondition; the observer's evidence is mandatory for this comparison.

`prepare.mjs` checks six baseline file hashes before writing into the separate fixed-source checkout.
It adds API tab/document/save events and observes all ten PFDSL `showTextDocument` call sites, including definition insertion and node navigation.
The observer returns the original `Thenable`; it adds a diagnostic completion handler.
DOM evidence records close targets, pointer events, hit tests, tab/group changes, focus, and dialog snapshots.
DOM object identities and API object identities are separate namespaces.
Compare them using URI, labels, columns, and timestamps rather than comparing numeric IDs.
Cross-process wall-clock differences and checkpoint intervals are diagnostic observations, not exact internal operation durations.

Before the original cleanup runs, the observer attempts to preserve DOM records, a screenshot, Code logs, the fixture, and process output independently.
Collection errors are reported and do not replace the original operation result or exception.
Each best-effort operation has a one-second diagnostic deadline, and the screenshot uses Playwright's own timeout as well.
An operation that cannot be cancelled may complete after its diagnostic deadline; completeness must be assessed from the saved evidence.
A failed launch may have only partial evidence, and a job forcibly cancelled or timed out may not reach cleanup or upload.
The artifact includes the actual instrumentation diff, helper sources, baseline and bundle fingerprints, lockfile checks, and the prior job status.
Missing or truncated evidence must be reported as such.

These files are diagnostic support only.
They do not modify the shipped extension on the PR branch, certify native acceptance, or close issue #1424.
