# Independent final synchronization review

Date: 2026-10-05. Scope: the three-file runtime/test synchronization diff after `dd5df03f`, and its directly related consumers. No checkout source, shared build output, Git metadata, or external system was changed by this review.

No unresolved actionable quality or correctness finding remains in the measured final diff.

## Anchors and design claims

- `packages/editor/src/preview.ts:419`: the common minimap clearing helper removes old content, hides the map, and resets natural dimensions.
- `packages/editor/src/preview.ts:555`: positioning rejects disposed, superseded, error, and zero-sized views. A hidden tab can therefore have no minimap until layout becomes visible; it cannot retain the prior graph after a new commit.
- `packages/editor/src/preview.ts:758`: asynchronous render completion is accepted only for the current revision and a live preview.
- `packages/editor/src/preview.ts:796`: the new source comment about matching graph revisions is supported by clearing the old minimap and positioning synchronously before the optional animation-frame pass. The scheduled pass is also revision guarded.
- `packages/editor/src/preview-ux.test.ts:116` and `:137`: the new regressions exercise stopped animation frames and a hidden tab.
- `packages/standalone/src/document-tab.ts:127`: asynchronous document processing retains its existing disposed/revision guard before markers and view updates.
- `packages/standalone/src/document-tab.ts:151`: the new comment about publishing visible source was checked against the installed Monaco implementation and an actual browser build.
- `packages/standalone/src/document-tab.ts:176`, `:185`, and `:190`: disposal, activation/layout, and one-operation formatting/Undo boundaries were checked for effects of the new rendering call.
- `packages/standalone/src/main.ts:30`: tab activation changes visibility before layout/refresh.
- Installed Monaco `esm/vs/editor/browser/widget/codeEditor/codeEditorWidget.js:1249` calls `view.render(true, forceRedraw)`. `esm/vs/editor/browser/view.js:565` sends that immediate branch through `_flushAccumulatedAndRenderNow`. Thus the default public `editor.render()` is an immediate view flush in the installed version, while retaining dirty-state tracking and the existing model/Undo contract.

The change keeps synchronization within the existing commit and lifecycle boundaries. The second animation-frame pass still allows later layout positioning. Hidden or zero-sized views deliberately clear prior minimap content rather than certify a render before dimensions exist. Source processing and graph drawing remain asynchronous; temporary divergence while a newer source is still being processed is distinct from settled output.

## Independent controlled DOM execution

Nine JSDOM scenarios passed against the final editor distribution module: stopped frames; update while hidden and show recovery; initial hidden/zero-sized graph; zero-sized inner SVG; out-of-order completions; stale renderer rejection; error invalidating a deferred render followed by recovery; disposal during a deferred render and pending frames; and manual pan/zoom plus one-shot focus cue through redraw.

These cases used controlled SVG promises and dimensions to test scheduling boundaries. They were not presented as actual Graphviz or native GUI observations.

## Independent production browser execution

Five scenarios passed in the actual production frontend with real Monaco and Graphviz while page `requestAnimationFrame` callbacks were deliberately queued: edited visible source and both SVGs; one-step Undo/Redo; two-tab source/SVG separation; malformed YAML and recovery; and manual pan/zoom preservation through editing with Fit still usable. No page errors were observed.

The startup is the Japanese tab. An initial review fixture incorrectly expected the Welcome tab and timed out before the stopped-frame scenarios; the reviewer corrected that expectation. The first combined browser run then passed four scenarios but compared pan before a source-position click with pan after editing. The source-position click legitimately invokes editor-to-preview focus. The reviewer moved the comparison point after that focus/selection and reran the fifth scenario alone; it exited 0, with identical before-edit/after-edit transforms. Neither fixture correction was a product Red result or a product source change.

## Measured version and limits

Production asset: `assets/index-wCSxiLhi.js`, SHA-256 `e1dcf67398971441d48540e8618916ca455c66e2f95793c91a3de2b5384a1463`.
Editor preview distribution: SHA-256 `f3a8774c715c3fcbe132c80f4162920c1c8cf23037f835dc91fa8f33e7726b2f`.
The accompanying JSON records the source fingerprints and individual scenario results.

The asynchronous/disposal cases directly exercised the shared preview. The standalone document-processing revision/disposal boundary was inspected in source; real-browser cases used the app's built-in tabs without native file I/O. This review does not certify native WebKit/compositing, IME, signed distribution, all user devices, or later builds. Native executable verification is separate.
