# Standalone feasibility experiment

This experiment evaluates whether the existing TypeScript PFDSL processing and preview can support a standalone macOS application with paired document editors and previews.
Tauri is the first prototype; Electron is a bounded comparator that loads the exact same built frontend from `dist/`.
Neither framework has been selected for the product; bounded runtime measurements and their limits are recorded in [RESULTS.md](RESULTS.md).
The agreed product requirements and the proposals that remain open are recorded separately in [SPEC.md](SPEC.md).

The prototype reuses the repository's core, Graphviz exporter, preview engine, and selected existing preview interaction calculations.
It uses Monaco for the editor, with a browser path adapter and host-specific file/PDF operations.
Tauri uses the macOS WebView and a separate WKWebView for PDF; Electron uses Chromium and a separate hidden PDF window.
The prototype does not introduce a second PFD language implementation or require a Node sidecar for the Tauri runtime.

## Current status and limits

This is a developer experiment, not an end-user installer or a completed implementation of the product specification.
Tauri editing, manual save, and paired tab switching were exercised on the copied corpus.
Transient blank captures occurred during UI verification; later captures showed text and line numbers with the original rendering settings, but their cause has not been isolated.
Local checks and the sample probe establish only the specific results they exercise; they do not establish feature parity or production readiness.
The current measurements do not establish a Tauri RAM advantage or settle framework selection.

The hosts compare the last known document text with disk content before saving, then replace the file through a temporary file.
That protects against an external change already visible at the comparison, but it is not a filesystem compare-and-swap: an independent writer can still change the file between comparison and replacement.
The product must close that race before claiming the agreed external-change protection is complete.
Conflict indication currently preserves the editor buffer but does not provide a complete conflict-resolution workflow.

## Reproduce the experiment

Use an Apple Silicon Mac with the repository's Node.js/pnpm development prerequisites, npm, Rust/Cargo, and the macOS native build tools installed.
These are developer build requirements, separate from the agreed product requirement that users install no additional development environment for viewing, editing, or PDF/PNG export.
The configured macOS deployment minimum is an experiment setting, not evidence that the final supported OS range has been tested.

Start in the repository checkout that contains this experiment, following that checkout's normal setup and approval rules:

```sh
make setup
make build
cd experiments/standalone
npm ci
npm --prefix electron ci
```

The root build must precede corpus preparation and the frontend build because both consume the local packages' built `dist` modules.
The frontend and Electron dependency sets have separate lockfiles and are not part of the root pnpm workspace.

Prepare separate disposable corpora for the two hosts in the same shell:

```sh
prototype_run=$(mktemp -d /private/tmp/pfdsl-standalone.XXXXXX)
tauri_workspace="$prototype_run/tauri"
electron_workspace="$prototype_run/electron"
node scripts/prepare.mjs "$tauri_workspace"
node scripts/prepare.mjs "$electron_workspace"
npm run build
npm run tauri -- build --bundles app
```

`prepare.mjs` takes a new absolute directory path as its first positional argument; the target directory must not already exist.
It copies `docs/samples/` and `.pfdsl/` with their relative structure, creates `exports/`, and writes the shared `generated/baseline.json` from the checkout's current source files.
The baseline records the current Git HEAD, source text, diagnostics, formatted text, and DOT expectations.
Because it reads working-tree content, also record any local changes when reporting results; HEAD alone does not describe an edited checkout.
Do not change source files between preparing the two corpora and building the shared frontend.
The second preparation rewrites the shared baseline, so finish both preparations before building `dist/`.

Launch the Tauri release bundle directly so the copied-corpus environment variable reaches the executable:

```sh
PFDSL_SPIKE_WORKSPACE="$tauri_workspace" \
  "./src-tauri/target/release/bundle/macos/PFDSL Prototype.app/Contents/MacOS/pfdsl-prototype"
```

If `CARGO_TARGET_DIR` is set, use that target directory's release bundle path instead.
Launch the same frontend in the Electron comparison:

```sh
PFDSL_SPIKE_WORKSPACE="$electron_workspace" \
  ./electron/node_modules/.bin/electron ./electron
```

Both hosts use the existing production Vite build, not a development server or devtools session.
When driving Electron through accessibility tooling, add `--force-renderer-accessibility` before `./electron` and record that flag in the measurement conditions.
Do not rebuild or modify `dist/` between the two runs.
The Tauri `.app` and the unpackaged Electron comparator are local experiment launch forms; they are not signed/notarized DMG release artifacts.

## Validation paths

Run focused checks from `experiments/standalone/`:

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm --prefix electron test
../../node_modules/.bin/biome check .
```

The frontend tests exercise document state, manual saves, external-change handling, and stale asynchronous results.
The native-host tests exercise workspace boundaries, symlink escapes, save conflicts, export paths, and PDF envelopes.
The Electron tests also check IPC sender validation and PDF window configuration without launching the real GUI.
These checks do not substitute for an actual editor, native close flow, or exported-file inspection.

In each application, select **Verify samples** to compare the copied documents with the generated Node baseline.
The probe lists `docs/samples/*.pfdsl` plus `.pfdsl/roadmap.pfdsl`, `.pfdsl/pipeline.pfdsl`, and `.pfdsl/workflow.pfdsl`.
It compares source, diagnostics, formatted text, and DOT, renders SVG, and attempts SVG/PNG/PDF exports for the Japanese-label, preset, and larger implementation-flow samples.
It writes the result, runtime errors, and editor-layout observations to that corpus's `exports/probe-report.json`.
Inspect the report's `passed`, per-document results, and any `error`, then inspect the exported files for full-graph dimensions, Japanese text, fonts, and clipping.
Use pristine corpora for baseline comparison; saved edits intentionally make source comparison fail.

Separately exercise tab switching, unsaved edits, formatting with Undo/Redo, manual save, clean external reload, dirty-buffer conflicts, and cancelling or discarding on close.
The current UI offers Discard/Cancel on a dirty close; it does not yet offer the complete proposed Save/Discard/Cancel workflow.
Keep all editing and external-write probes inside the copied corpora, not the repository's original samples.

For future measurements, keep the Mac, OS, frontend bytes, documents, window size, tab count, and operation sequence identical.
Record host/library versions and include related WebView/renderer/GPU processes in the measurement scope.
Report startup time, distribution size, memory, and response time separately; a simple sum of process RSS is not total physical memory usage.
Repeated measurements and a defined treatment of shared memory remain necessary before comparing framework memory costs.

## Deliberately incomplete product scope

- PFDSL-specific syntax highlighting, hover, completion, definition insertion, connector editing, and the full existing language-feature set are not integrated into Monaco; the prototype uses plain-text models with diagnostic markers and a format action.
- Arbitrary file/folder opening, new documents, Save As, recent files, OS file association, directory candidate selection, and complete related-PFD navigation are not implemented.
- External file/browser opening and Terminal.app/Ghostty command execution are not implemented; the comparison hosts do not run PFD commands or launch external applications.
- Git comparison, file comparison, preview minimap, and the full existing output/batch-export set are not implemented; the visible export actions are SVG, PNG, and PDF.
- Session restoration, unsaved-buffer recovery, crash recovery, complete conflict resolution, and protection against an external writer during the save comparison/replacement interval are not implemented.
- Signed/notarized DMG distribution, release publication, update notification, Intel Mac support, and Windows support have not been implemented or validated in this experiment.

These omissions bound the experiment; they do not revoke the agreed product requirements or turn the unapproved proposals in SPEC.md into commitments.
