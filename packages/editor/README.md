# Shared PFDSL editor foundation

This private workspace package supplies the document processing, editing calculations, source positions, preview messages, and preview DOM used by the VS Code extension and the Tauri application.
It has no VS Code, Monaco, Tauri, filesystem, dialog, terminal, or save implementation.

`analyzeSnapshot` retains the authored source map.
`prepareDocument` resolves presentation through a supplied preset loader, keeps entry and preset diagnostics separate, and produces the shared render/error message.
`preloadPresets` adapts an asynchronous host reader to that loader without replacing the unsaved entry with its disk version.
Missing or cyclic presets retain the existing VS Code preview's lenient presentation behavior; entry errors prevent rendering.

`@pfdsl/editor/preview` exposes `mountPreview(container, host)`.
Each mount owns its DOM, view state, listeners, and render revision; `dispose()` cancels listeners and invalidates pending results.
The host routes messages to the correct document and supplies editor selection, Undo, file access, and external actions.
The VS Code webview supplies its message transport; Tauri connects the same component directly to a paired Monaco editor.

Connector and definition-insertion calculations, formatting, and source-map-based definition positions are shared APIs.
The new preview editing menus and occurrence-cycle gesture remain tracked by their feature issues.
Moving their existing calculations here does not implement those features.

The browser preview imports `@pfdsl/preview-engine/renderer`, and document processing imports `@pfdsl/graphviz-exporter/dot`.
These entries keep the Node-only PDF/PNG implementation out of browser bundles while retaining the existing public entries for CLI and extension consumers.
The desktop bundler supplies a POSIX path adapter for the core's existing path API; it does not introduce a second PFD parser or a Windows implementation.

Run the package tests through the repository's normal setup, build, and test procedure.
Moved calculation tests retain the extension's coverage thresholds.
The DOM layer was excluded from the extension coverage floor before this move; lifecycle and message-routing tests now exercise it separately.
