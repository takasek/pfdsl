# Independent cursor and scroll synchronization follow-up

The incremental `document-tab.ts` scheduler diff has no unresolved actionable quality or correctness finding in this review. The earlier stopped-frame Red observation remains frozen in `/private/tmp/pfdsl-monaco-scroll-red-01a10a12`; the earlier short-source/main/minimap review is a separate build record.

Reviewed anchors: `packages/standalone/src/document-tab.ts:55` coalesces public-event rendering through one queued microtask; `:59` states the cursor/reveal/scroll ordering claim; `:65` and `:66` subscribe to scroll and cursor-selection events; `:171` requests rendering on content changes; `:189` sets the disposed guard before disposing the editor/model. The queued callback checks that guard at `:62`. Source processing still flushes visible source before the graph at `:164`.

The source comment was tested against installed Monaco 0.57.0: the public cursor event can arrive with logical position (1,1) and old scrollTop 655, followed by a scroll event with scrollTop 0. The final timing evidence is `public-event-timing-settled.json` in the Red directory. Immediate cursor-only rendering left the old viewport in that harness; the scroll-stage flush used the adopted viewport. Coalescing through the microtask therefore matches the observed event boundary. Coalescing and dispose suppression were checked in source; their callback counts and cancellation were not separately instrumented in the production app.

Four actual-production-browser cases passed on `assets/index-CTNe7B5u.js`: the same stopped-frame Cmd+Up Red replay; Cmd+Down back to the current tail; selection painting and collapse; and direct wheel scroll. The first painted line after Cmd+Up was line 1. Selection produced two rectangles and collapse removed them. Direct wheel scroll moved the first painted line from 1 to 3. Main and minimap semantic IDs matched in the Cmd+Up replay. No page errors occurred.

The final observation clips line nodes to the editor viewport and sorts them by physical top. Monaco reuses DOM line nodes, so DOM insertion order does not define visible line order. A first checker used DOM insertion order and stopped at an unsuitable first-line assertion; its raw `failure.json` remains in `/private/tmp/pfdsl-monaco-scroll-green-01a10a12` and is not treated as a product Red. The corrected physical-order replay exited 0.

Production asset SHA-256: `202275cb1c4132cf3fbbab165657409d61e16aebd61f9576a02c081662973142`.
Final `packages/standalone/src/document-tab.ts` SHA-256: `6796dc21775be9a8b924b72669b5c32a550e7a1c10f7be039328add4b3f41135`.

Evidence in this directory: `report.json`, `01-cmd-up.png`, and `02-direct-scroll.png`. The report preserves physical viewport observations and the source/build fingerprints.

The replay used actual Monaco and Graphviz in the production browser build, with page animation-frame callbacks paused after previously scheduled work drained. It verifies browser DOM painting under that condition. Native WebKit/compositing, native AX textarea behavior, IME, signing/distribution, and a later build remain outside this proof. No product source, shared build output, Git metadata, or external system was changed by the reviewer.

Stored-copy note: the evidence basenames described above belong to the original temporary directory. The stored names and original/stored fingerprints are mapped in [browser-scroll-manifest.json](browser-scroll-manifest.json).
