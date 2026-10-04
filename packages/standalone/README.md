# PFDSL desktop application

The product source lives here, separate from the feasibility experiment in `experiments/standalone`.
This is the shared-foundation stage of the Tauri application for Apple Silicon Macs.
It uses the same document services and preview DOM as the VS Code extension.
It does not run a Node sidecar or parse PFDSL in Rust.

After the repository's normal setup and build, start the native development application:

```sh
pnpm --filter @pfdsl/standalone tauri dev
```

Build a local application bundle:

```sh
pnpm --filter @pfdsl/standalone tauri build --bundles app
```

Rust/Cargo, Xcode command-line tools, and the repository's Node/pnpm prerequisites are developer build requirements.
They are separate from the eventual installation requirements for distributed users.
The macOS CI job compiles an Apple Silicon app and runs native unit tests; it does not certify GUI or IME behavior.

Each tab pairs its editor and preview.
Choose **Open folder…** to list PFDs in that folder and open them as additional tabs.
Format is an Undoable editor operation, and editor/node navigation uses the shared source positions.
The native host holds a directory capability for each folder explicitly selected for that session.
Reads stay bound to that directory when its pathname is replaced; relative traversal and symlink escape are rejected.

This foundation build keeps edited text in memory and does not save files.
Closing after an edit asks before discarding it.
Complete saving, external-change protection, and close recovery belong to the document-editing stage.
Syntax highlighting and the remaining PFD-specific language commands, external navigation, export, and distribution remain in the [acceptance matrix](ACCEPTANCE.md).
Local `.app` builds are not signed/notarized release DMGs.

## Verification

The workspace tests compare every top-level sample plus the three operational PFDs through the production VS Code snapshot adapter and the desktop processing adapter.
They compare the authored model, diagnostics including positions, preset diagnostics, formatting, DOT, and SVG DOM.
Browser-asset checks reject unresolved Node builtins and Puppeteer imports.

Native acceptance uses a new disposable corpus and the exact built frontend:

```sh
node packages/standalone/test/prepare-native.mjs /absolute/new/corpus \
  "$PWD/packages/standalone/src-tauri/target/release/bundle/macos/PFDSL.app/Contents/MacOS/pfdsl-desktop"
PFDSL_ACCEPTANCE_ROOT=/absolute/new/corpus \
  packages/standalone/src-tauri/target/release/bundle/macos/PFDSL.app/Contents/MacOS/pfdsl-desktop
```

Use the `target/debug` bundle path if building with `--debug`.
Preparation copies the samples and operational PFDs, then records source hashes, frontend and native executable fingerprints, and baseline results from the VS Code adapter.
The native app reads those copies through its native reader, runs the desktop pipeline and shared DOM renderer, and creates `native-report.json` once in that corpus.
The native host also measures the running executable's hash and rejects a different build from the prepared baseline.
The report has per-document results, the actual executing path/hash, and explicit failures; absence of a report is not success.
The verification mode is enabled only by the explicit environment variable and has no UI menu or arbitrary report destination.

GUI checks still require the actual application: Japanese text, real IME composition and commit, live redraw after editing, large diagrams, tab switching, zoom/pan, and safe close behavior.
The acceptance record states which checks were observed and which remain unverified.
