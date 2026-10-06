# Related experience review — frozen UI evidence

Worktree: `<checkout>`.
Requested branch: `codex/issue-1352-preview-editing` (supplied by parent).
Date: 2026-10-05 JST.
Evidence directory: `browser/`.

This is a blind UI review.
No implementation source, final diff, design record, unit-test results, or design reasoning was read.
Operation hints came from `packages/vscode-extension/README.md` and `packages/standalone/README.md`.
`packages/vscode-extension/smoke/run.mjs` was read only to use its actual isolated VS Code launch API.
The worktree guide and pfdsl skill's syntax were read for the required operating boundaries.
No product file, Git metadata, external service, or existing user window was changed.

## Environment and executed host

The browser review serves the current production `packages/standalone/dist` on `127.0.0.1` through an owned temporary HTTP server, in an independent headless Chrome process.
Chrome reports `154.0.8037.95`; viewport is 1500 × 1000 CSS pixels.
The frontend uses its production Monaco editor and shared SVG preview without a test mock or replacement document service.
Edits use actual editor focus, clipboard paste, keypresses, context menus, form fields, toolbar controls, SVG clicks, mouse movement, and wheel events.
Monaco's hidden Native EditContext element has no click geometry, so mouse input targets visible editor lines.

Initial page asset: `assets/index-DELWlx87.js`, SHA-256 `8dd8901971ffb20a8ab6d57820c93d390bdb45b725072150033b058f883d6b04`.
Initial `index.html` SHA-256: `47f6b0bffd7b7d1cb240c40b4fa94cd60b7873a5fc5f62a43e1aa58f60fcee86`.
All initial dist asset hashes are in `asset-hashes.json`.
The parent rebuilt while the page stayed open, so the observations below retain the initially loaded frontend.
On-disk assets after the parent build are separately fingerprinted and must not be described as the executed initial build.

The input is stored as `fixture-input.txt`; the same text is entered in the 日本語 tab's in-memory document.
It contains declared a and lonely artifacts, declared p and q processes, and initially undefined b and c:

```pfdsl
a >> p -> b
b >>? p
b >> q -> c
lonely
```

`fixture-with-beta.txt` preserves the result after creating b and changing its label to Beta.
The second built-in Welcome tab remains independent.
No fixture is read or saved through the native Tauri folder reader.

## Observed operation results

| Input / operation | Expected | Actual | Evidence |
| --- | --- | --- | --- |
| Right-click undefined b; Create definition; type Beta | Artifact b definition inserted, label selected, graph redraws | Inserted one b definition; typing replaces b with Beta; main SVG shows Beta | `browser-b-rightmenu.png`, `browser-b-created.png`, `browser-b-label.png`, `create-edit-undo-redo.json` |
| Undo/Redo label edit | One Undo restores b, one Redo restores Beta | Both matched exact visible source | `create-edit-undo-redo.json` |
| Create c, then Undo/Redo without typing | Definition insertion is one editor operation | One Undo exactly restores prior source; Redo exactly restores c definition | `definition-one-operation.json` |
| Reopen b menu after definition exists | Prevent duplicate definition | Create definition is not visible | `create-edit-undo-redo.json` |
| p menu input/output/feedback, existing lonely and new incoming/outgoing/feedback IDs | Correct arrow direction and source operation | All six produce the expected `lonely >> p`, `p -> lonely`, `lonely >>? p`, `incoming >> p`, `p -> outgoing`, `feedback >>? p`; all Undo once to baseline and Redo once to changed source; SVG contains the affected ID | `connections.json`, `connect-*.png` |
| Open b menu; source adds b definition, changes b to process, or removes b | Old menu cannot mutate new source | Create disappears; clicking former Create button coordinates leaves source unchanged in all three cases | `stale-menus.json`, `stale-*.png` |
| Switch from edited 日本語 to Welcome and back with node menu open | Edited document remains its own tab; menu does not carry over | Welcome has its original text, edited Beta text returns unchanged, Add connection is hidden in both transitions | `tab-switch.json` |
| Hover p | Only actual immediate-neighbor topology | Tooltip SVG IDs are a,p,b; edge titles a→p, b→p, p→b; no q or c | `hover-p.json`, `hover-p-isolated-or-undefined.png` |
| Click b inside p neighborhood | Main graph identifies target | Main b has `pfdsl-focus-cue` and computed blue 2px outline | `focus-b-from-neighborhood.png`, `hover-p.json` |
| Hover undefined c | Correct neighborhood without stale metadata | Tooltip IDs c,q; edge q→c; no prior p card text | `hover-gestures.json`, `hover-c-isolated-or-undefined.png` |
| Hover isolated lonely | Isolated graph is usable | Tooltip has only lonely and no edges, with Lonely label | `hover-gestures.json`, `hover-lonely-isolated-or-undefined.png` |
| Move from b into tooltip, horizontally wheel, click q | Tooltip remains interactive | Visible after 700ms inside; horizontal scrollLeft 0→60; q click cues main q | `hover-enter-horizontal-scroll.png`, `hover-gestures.json` |
| Pan c near right/bottom viewport edge, then hover | Card stays within viewport | Card right=1492, bottom=992 inside 1500×1000 viewport | `hover-viewport-edge.png`, `hover-gestures.json` |
| Wheel / background drag / background double-click | Existing zoom, pan, reset remain | Scale 1→1.1; drag adds +40/+35; background double-click returns scale 1 | `hover-gestures.json` |
| Double-click b | Source navigation, no edit | Editor reveals b source, visible source unchanged | `doubleclick-b-source.png`, `hover-gestures.json` |
| Actual keyboard Tab traversal to c; Enter | Keyboard-accessible node actions | Active element is SVG g with ID c and `Node c. Enter for Node actions.`; Enter opens Create definition | `keyboard-actions.json`, `keyboard-enter-node-actions.png` |

No browser page errors were observed during these scenarios.
The neighborhood SVG can exceed its 340px visible container, which offers working horizontal scrolling; the final neighbor remains reachable through that scroll and a real click.
This is a visible layout behavior, not evidence of a missing neighbor.

## Actionable finding from initial frontend

After focusing b from p's neighborhood, selecting another authored node in the Monaco editor does not clear b's visual cue immediately.
Reproduction: enter the fixture with b defined as Beta; Fit; hover p; click b in the neighborhood; within the cue interval, click the frontmatter a key, then select the a character with End, Left, Left, Shift+Right.
At 100ms after the editor selection, the main graph still reports cue ID b and still shows the blue outline on b.
The first run also retained b at 50ms after moving the caret to a.
Both screenshots show the editor positioned on a while b remains outlined.
The outcome can misidentify the current target during quick editor selection.

Evidence: `cue-after-a-text-selection.png`, `cue-cleared-by-editor-selection.png`, `cue-selection-redraw.json`.
The exact initial measurements are `beforeSelect=[b]`, `afterSelect=[b]`, `afterRedraw=[]`.
A source redraw clears the cue and does not reapply it.
This finding is reported to the parent for recheck after the final frontend build.

## Initial VS Code host blockage

The actual `launchSmokeSession()` harness resolves pinned VS Code `1.132.1` at:

```text
/var/folders/9_/4tpbkqtx4736th9prcgtb0yh0000gn/T/pfdsl-vscode-smoke-cache/pfdsl/vscode-darwin-arm64-1.132.1/Visual Studio Code.app/Contents/MacOS/Code
```

It exits with SIGKILL before CDP becomes available: process code=null, signal=SIGKILL; stdout and stderr empty; extension-host logs absent.
The launch harness runs its cleanup on that failure.
`file` confirms a Mach-O arm64 executable.
The app-level `codesign --verify --deep --strict` returns `bundle format unrecognized, invalid, or unsuitable`.
The independent read-only environment review found the cache lacks `Contents/Info.plist`, and binary signature verification reports `invalid Info.plist (plist or signature have been modified)`.
This is a pre-extension-host cache failure; the extension was never exercised in VS Code.

This initial cache failure was subsequently recovered by the parent using a new dedicated cache of the same pinned VS Code version, without modifying the shared cache or signature policy.
The executed fresh-cache results are recorded below and supersede a blanket statement that VS Code was not run.

## Final loaded frontend recheck

The final browser session loaded `assets/index-Bhq5YRen.js`, SHA-256 `30862c67c53eef585d8c2b0a416cb9c953a78f27b07a24991817dbc93e8d8abf`.
Its `index.html` SHA-256 is `b5ffe748c7833ee7cb9702c16852c6a31dce70aa9aba3002ea5cdf7107373e72`.
All final frontend hashes are in `asset-hashes-final.json`.
These identify the assets loaded at session launch; later parent builds were not reloaded or automatically treated as the executed version.

The initially reported cue finding is resolved in this final loaded frontend.
After neighborhood b click, main cue ID is b; 100ms after clicking the frontmatter a key, main cue ID is a.
Evidence: `final-browser-cue.json` (`b=[b]`, `a=[a]`) and `final-browser-cue-a.png`.

Using the quoted IDs `prep task` and `spare item`, an existing input connection writes `"spare item" >> "prep task"`.
One Undo exactly restores the quoted fixture and one Redo restores the added connection.
The undefined process ID constructor shows Create definition and inserts a frontmatter process definition with label constructor.
Evidence: `final-browser-recheck.json`, `final-browser-quoted-connectors.png`, `final-browser-constructor-definition.png`.

The attempted new ID `new target` contains a space and is rejected by the bare-ID rule confirmed by the parent.
The browser header was observed to show the prefix `Invalid ID — use letters, numbers, _ or - (must s…` in the tool's truncated element representation.
The text stayed unchanged and the menu closed.
This rejection is expected behavior and is not a product failure.
The valid new ID `new_target` was not retried before the observation freeze, so final-build quoted-current → valid-new-target connector/Undo remains unverified.
The initially recorded `newCorrect=false` in `final-browser-recheck.json` refers to the rejected space-containing ID.

One browser pageerror message `p.map is not a function` was collected by the message-only event listener during the combined final sequence of quoted existing connector, Undo/Redo, rejected new space-containing target, replacement with `a >> constructor -> b`, and constructor definition creation.
The listener did not timestamp individual operations or capture a stack at that time.
The exact triggering operation, repeatability, and product impact are not established.
A stack-capturing listener was attached afterward, but no reproduction was completed before the freeze.
The later rejected-space-target attempt did not increase the saved error-message count.
All fixture replacements in this browser session used actual clipboard paste into the production Monaco editor; the review did not directly call Monaco `executeEdits` or supply its third argument.
Thus the observed exception must not be attributed either to product implementation or to a direct test-side `executeEdits` call without a further reproducing stack.
The completed constructor creation and quoted existing connector had the source outcomes above, despite this unresolved pageerror.
Evidence: `final-browser-recheck.json` and `final-browser-quoted-new-failure.json`.

## Fresh VS Code 1.132.1 executed results

The fresh session uses `<temporary>/pfdsl-vscode-fresh-harness-01a10a12.mjs`, which the parent prepared from the original launch harness with import paths, repoRoot, and cachePath replaced.
The pinned executable is under `<temporary>/pfdsl-vscode-fresh-cache-01a10a12/vscode-darwin-arm64-1.132.1/Visual Studio Code.app`.
The launched isolated process PID was 96372; its profile/fixture directory was `/var/folders/9_/4tpbkqtx4736th9prcgtb0yh0000gn/T/pfdsl-vscode-smoke-CZyuNL`.
The extension loaded from this worktree's dist.
At launch, `extension.cjs` SHA-256 was `de8f6bc205d1c838fc83aa9d18fd3c042015f77e25c35173522eb8e488f2eebd`; `webview.js` SHA-256 was `71013b010e66971a059cbb41cb4205724f04106a014c950524cf383141f24199`.
The isolated preview rendered the initial sample's three SVG nodes through the actual extension webview.
Evidence: `vscode-initial.png`.

The navigation fixture contains a definition key named status, an unrelated `a.status` field, and `a >> p -> a` on one body line; its input is saved as `vscode-navigation-fixture-input.txt`.
The fixture was loaded through the isolated file and VS Code's actual File: Revert File command after a multiline keyboard insertion proved unsuitable because of editor autoindent.
The browser Clipboard API is permission-denied in the VS Code workbench; that failed preparation attempt did not exercise a product command.

| Actual UI action | Observed selection/cursor |
| --- | --- |
| Command Palette: PFDSL: Cycle Node Occurrences from status definition key | `Ln 13, Col 7 (6 selected)` on body status |
| Actual macOS ⌘K, ⌘Alt+N from body status | `Ln 3, Col 9 (6 selected)` on definition key |
| Cycle command from a definition key | `Ln 12, Col 2 (1 selected)` on first same-line a |
| Actual ⌘K, ⌘Alt+N | `Ln 12, Col 12 (1 selected)` on second same-line a |
| Actual ⌘K, ⌘Alt+D | `Ln 5, Col 4 (1 selected)` on a definition key |
| Cycle command from unrelated status metadata field | Stays at `Ln 7, Col 7` |

Extension command results were sampled after a 350ms wait for asynchronous execution; immediate sampling initially read older status-bar positions and was discarded.
Evidence: `vscode-navigation.json`, `vscode-cycle-status-body.png`, `vscode-direct-chord-definition.png`.

The editor context-menu attempt produced no DOM menu items and did not complete a Cycle selection.
A separate native accessibility read with the exact fresh app path hung and was aborted before any native input action.
No context-menu command result is claimed.
The VS Code preview definition/connector/Undo, hover/cue, missing-definition/body cycle cases were not completed before the freeze.
The actual preview render and navigation command/chord results above must not be expanded into those unexecuted acceptance claims.

## Remaining limits and observed impact

The initial stale b cue has a confirmed final-frontend repair.
No other demonstrated user-impacting regression is established by the completed final rechecks.
The one unclassified browser pageerror remains unresolved; its stack and repeatability would be needed before claiming an error-free final GUI sequence or assigning a repair.
Final valid-new-target connector/Undo and the VS Code preview interactions listed above remain unverified.
The initial frontend's ordinary six-direction connector/Undo and hover/gesture evidence remains valid for its recorded asset version only.

The browser result cannot establish native Tauri window behavior, folder capabilities/native reader, OS dialogs, IME composition/commit, native close behavior, or a distributed app.
The fresh Electron run establishes only the executed VS Code render/navigation scenarios.
The native .app build limitation is handled separately by the parent and another agent.

## Cleanup

The VS Code launch harness cleaned its failed isolated session.
The fresh VS Code driver received CLEANUP and returned `cleanup: []`; the isolated process/profile cleanup completed without reported errors.
The final browser driver received CLEANUP and returned `cleanup: true`; its owned browser and local-only server closed.
The earlier browser tool session had already become unavailable before the final launch; no existing user browser was controlled.
Review scripts and evidence remain under `/private/tmp` only, for the parent to use in the durable review record.
The GUI report is frozen before the separate CLI source review begins.
