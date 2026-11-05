# Independent stopped-frame viewport Red observation

The fingerprinted production asset `assets/index-wCSxiLhi.js`, SHA-256 `e1dcf67398971441d48540e8618916ca455c66e2f95793c91a3de2b5384a1463`, reproduces a settled visible viewport discrepancy after Cmd+Up while page animation-frame callbacks are paused.

A new 35-process document was pasted and observed at its tail. Cmd+Up left the screenshot on current-document lines 16–39. Switching away and back showed the current document's first line and title. The stale text is the current document's tail, not content from the prior Japanese startup document. The report's `visibleLines` arrays list rendered DOM line nodes; after tab return, cached off-viewport nodes also remain in that array. The screenshot is the authoritative visible clipping observation.

The production Chrome editor uses a native EditContext DIV textbox; its textarea value was empty. The production observation does not claim to reproduce a native AX textarea value. A separate installed-Monaco API harness with `editContext:false` confirmed the logical cursor/scroll/textarea timing.

Actionable boundary: `packages/standalone/src/document-tab.ts:151` flushes visible source only during source processing; `:163` processes cursor movement for preview focus without a post-reveal view flush. Cursor-only flushing cannot generally synchronize the revealed viewport.

In the settled public API harness, Cmd+Up emitted `onDidChangeCursorPosition` at logical position (1,1) while `getScrollTop()` still returned 655. Its later `onDidScrollChange` observed scrollTop 0. With no explicit flush or cursor-only immediate flush, painted lines remained at `current_document_line_32` while the textarea began at line01. Flushing on the scroll event painted line01. The modes and event snapshots are in `public-event-timing-settled.json`.

The earlier `public-event-timing.json` harness did not drain animation frames scheduled before pausing, so a pre-existing native callback could later render the viewport. It remains raw history; the settled file drained 250ms before each case and is the final timing result.

Evidence: `report.json`, `01-current-tail.png`, `02-cmd-up-paused.png`, `03-tab-return.png`, and `public-event-timing-settled.json` in this directory. No product source change was made by the reviewer.

This is production browser DOM evidence plus a separate installed-Monaco timing harness. It does not certify native WebKit/compositing, IME, or a later build. Previously passing short-source/main/minimap results remain versioned separately.

Stored-copy note: the evidence basenames described above belong to the original temporary directory. The stored names and original/stored fingerprints are mapped in [browser-scroll-manifest.json](browser-scroll-manifest.json).
