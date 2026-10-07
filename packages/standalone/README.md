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

## Linux verification

Linux is a development verification environment; the distribution target remains Apple Silicon macOS.
Run these commands from the repository root on the Linux machine, using its native CPU architecture.
Use Node.js 24 (as in CI), the pnpm version in the root `packageManager`, and a stable Rust toolchain installed using the [official prerequisites](https://v2.tauri.app/start/prerequisites/).
A graphical desktop session is required to open the application and operate its dialogs.

For Debian or Ubuntu, install the build dependencies using the distribution package manager:

```sh
sudo apt update
sudo apt install build-essential pkg-config curl wget file \
  libgtk-3-dev libwebkit2gtk-4.1-dev libssl-dev \
  libxdo-dev libayatana-appindicator3-dev librsvg2-dev
```

Other distributions use the packages listed in [Tauri's Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).
The package list is a setup procedure, not evidence that any particular cloud desktop has been verified.
Check the toolchain and development libraries before building:

```sh
node --version
pnpm --version
rustc --version
cargo --version
pkg-config --modversion gtk+-3.0 webkit2gtk-4.1
make setup
make build
cargo test --manifest-path packages/standalone/src-tauri/Cargo.toml --locked --lib
pnpm --filter @pfdsl/standalone tauri build --no-bundle -- --locked
```

The [no-bundle option](https://v2.tauri.app/reference/cli/#build) skips packaging while building the frontend and native executable.
It does not require changing the macOS bundle configuration or creating AppImage, deb, or rpm packages.
With the default Cargo target directory and no explicit `--target`, launch the resulting executable:

```sh
packages/standalone/src-tauri/target/release/pfdsl-desktop
```

For iterative work in the graphical session, use `pnpm --filter @pfdsl/standalone tauri dev` instead.
A missing display, a build failure, or an unavailable dialog is a failed or blocked step; retain the error before changing the environment.

For the native corpus comparison, pass the Linux executable to the existing preparation tool and use a new absolute corpus directory:

```sh
node packages/standalone/test/prepare-native.mjs /absolute/new/corpus \
  "$PWD/packages/standalone/src-tauri/target/release/pfdsl-desktop"
PFDSL_ACCEPTANCE_ROOT=/absolute/new/corpus \
  packages/standalone/src-tauri/target/release/pfdsl-desktop
```

The corpus mode starts with a native directory capability already selected; it does not verify the folder picker.
Run the ordinary application without `PFDSL_ACCEPTANCE_ROOT` for the separate folder-selection, cancellation, and dirty-window-close scenarios in the [acceptance record](ACCEPTANCE.md#linux-verification-and-grouped-preview-acceptance).
Use disposable copies and compare their hashes before and after the GUI session.
Record the source commit, executable SHA-256, OS/CPU, toolchain and GTK/WebKit versions, each observed result, and all unverified conditions.
Linux results do not replace macOS-specific IME, shortcut, or dialog acceptance.

Apple's [container](https://github.com/apple/container) can provide a Linux environment for dependency, Rust-test, and no-bundle-build checks on a Mac.
A headless container alone does not provide the desktop session needed for GUI acceptance.
An arm64 container build also does not verify a cloud desktop running x86_64.
Container setup is optional; this procedure can be used directly on the target Linux desktop.

### Use a CI executable when development dependencies are unavailable

The `desktop` workflow's `linux-native` job tests and builds the PR head commit on x86_64 in a pinned Debian 13 container.
After that job succeeds, download its `pfdsl-linux-x64-<source-commit>` artifact from the workflow run.
It contains `pfdsl-linux-x64.tar.gz`; extract it into a new directory, then check its contents:

```sh
mkdir /absolute/new/linux-verification
tar -xzf /path/to/pfdsl-linux-x64.tar.gz -C /absolute/new/linux-verification
cd /absolute/new/linux-verification
sha256sum -c SHA256SUMS
cat SOURCE_COMMIT
cat build-environment.txt
ldd ./pfdsl-desktop
```

Compare `SOURCE_COMMIT` with the PR head you intend to verify.
The archive preserves executable permissions and includes the executable, the frontend built into it, the source commit, build-environment versions, and hashes of those files.
The frontend files are included for identification; the executable already embeds the frontend and does not need a separate web server.
Download artifacts only from the expected repository, run, and commit; the included hashes detect changed files but do not authenticate their origin.

The target does not need Rust, Cargo, or development headers to run this executable.
It still needs compatible runtime libraries and a graphical desktop session.
If `ldd` reports `not found`, retain that output and resolve the listed runtime dependencies before attempting GUI acceptance.
The build uses Debian 13; compatibility with older distributions is not certified.
With those checks satisfied, launch `./pfdsl-desktop` for the normal folder-picker and dirty-close scenarios.
For corpus preparation, use a checkout and local JS build at `SOURCE_COMMIT`, and pass the absolute path of this executable to `prepare-native.mjs`.
Compare the archive's `frontend/` hashes with that checkout's `packages/standalone/dist/` before treating locally prepared frontend metadata as identifying this executable.
CI unit tests and compilation do not certify native startup, dialogs, GUI operations, or corpus acceptance on the target desktop.

### Use the verification AppImage when WebKitGTK runtime is unavailable

The same job also packages a verification-only [AppImage](https://v2.tauri.app/distribute/appimage/) and uploads `pfdsl-linux-appimage-x64-<source-commit>`.
This is an Actions artifact for acceptance work, not a signed release.
The job extracts the built image and requires both `libwebkit2gtk-4.1.so.0` and `libjavascriptcoregtk-4.1.so.0` inside it before uploading.
The archive also includes the frontend, source commit, build environment, outer checksums, and checksums of the extracted image's regular files.
That inspection proves inclusion; compatibility and startup on the target desktop still need verification.
The builder is Debian 13 x86_64; older systems are not certified, and the AppImage still needs a compatible kernel, glibc, graphics stack, and graphical session.

Check the artifact's repository, run, and source commit as above, then extract its `pfdsl-linux-appimage-x64.tar.gz` into a new directory.
Use AppImage extraction to avoid requiring FUSE or installation privileges:

```sh
cd /absolute/new/appimage-verification
sha256sum -c SHA256SUMS
cat SOURCE_COMMIT
cat build-environment.txt
./PFDSL.AppImage --appimage-extract
cd squashfs-root
sha256sum -c ../APPDIR_SHA256SUMS
test -x AppRun
test -x usr/bin/pfdsl-desktop
LD_LIBRARY_PATH="$PWD/usr/lib:$PWD/usr/lib/x86_64-linux-gnu:$PWD/usr/lib64" \
  ldd ./usr/bin/pfdsl-desktop
```

Record any `not found` or version error and stop before GUI/corpus acceptance if dependencies remain unresolved.
This library-path check is a preflight; launching through `AppRun` also supplies the bundled GTK/WebKit resources and environment.
When preflight succeeds, run `./AppRun` from the extracted directory for folder selection, cancellation, and dirty-close checks.
Do not launch `usr/bin/pfdsl-desktop` directly for these checks.

For corpus preparation, build the JS workspace at `SOURCE_COMMIT` and compare the archive's `frontend/` hashes with the checkout's standalone `dist/` first.
Pass `/absolute/new/appimage-verification/squashfs-root/usr/bin/pfdsl-desktop` to `prepare-native.mjs`, then run `PFDSL_ACCEPTANCE_ROOT=/absolute/new/corpus ./AppRun` from the extracted directory.
Preparation must hash the inner native executable because the native host fingerprints the running executable; the outer AppImage and `AppRun` have different hashes.
Record the outer AppImage and inner executable hashes separately.
An AppImage dependency check does not certify folder dialogs, GUI interaction, or native corpus acceptance.

## Application behavior

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
