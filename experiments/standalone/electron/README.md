# Electron comparison harness

Private feasibility comparator using Electron 43.0.0 and the exact `../dist` frontend built for the Tauri spike.
It does not contain a separate implementation of parsing, checking, Graphviz rendering, or editing.

Run commands from this directory after the parent frontend build:

```sh
npm ci
npm test
PFDSL_SPIKE_WORKSPACE=/absolute/path/to/copied-corpus npm start
```

The copied corpus must contain `docs/samples`, `.pfdsl`, and `exports` directories.
The host lists `docs/samples/*.pfdsl` and `.pfdsl/{roadmap,pipeline,workflow}.pfdsl` and permits document access only to `.pfdsl` files inside that corpus.
Paths are normalized and resolved before access, including symlink targets.
Document saves compare `expectedText` with disk content, then atomically replace the file.
An independent writer can race that comparison and replacement; see the parent README's explicit limitation.
Exports are limited to `.svg`, `.png`, `.pdf`, and `.json` beneath `exports/`.

The preload exposes `window.pfdHost.invoke(command, args)` for `list_documents`, `read_document`, `write_document`, `write_export`, and `export_pdf`, matching the Tauri argument and result contracts.
`window.pfdHost.onCloseRequested(callback)` returns an unsubscribe function; the async callback must return `true` to close, and any other result or error keeps the window open.

The main window loads only the built local frontend, uses context isolation and sandboxing, disables Node integration and devtools, and rejects IPC from any other frame or URL.
It blocks navigation, new windows, permissions, and requests outside the frontend distribution plus local data/blob resources.
The shared frontend must provide its CSP through a meta tag because this comparator loads `file://` content.

PDF uses a separate hidden window without a preload or JavaScript and with all subresources blocked.
The input is the trusted shared Graphviz renderer's static SVG; the envelope rejects active SVG elements and is not a general XML sanitizer.
The entire requested CSS pixel size becomes the PDF page, converting pixels to inches at 96 pixels per inch.
The window is destroyed after rendering.
Node tests cover path constraints, save conflicts, IPC wiring, and PDF configuration; actual window rendering and memory measurements belong to the parent comparison run.

API references: [Electron 43.0.0](https://releases.electronjs.org/release/v43.0.0), [security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window), and [printToPDF](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions).
