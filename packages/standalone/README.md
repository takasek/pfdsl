# PFDSL desktop application

The product source lives here, separate from the feasibility experiment in `experiments/standalone`.
This Tauri application targets distribution on Apple Silicon Macs; Linux is also supported as a development verification environment.
It uses the same document services and preview DOM as the VS Code extension.
It does not run a Node sidecar or parse PFDSL in Rust.

## Building and development

Install Node.js 24, pnpm (the version pinned in the root `package.json`), stable Rust via [rustup](https://v2.tauri.app/start/prerequisites/#rust), and make.
On macOS, install [Xcode Command Line Tools](https://v2.tauri.app/start/prerequisites/#macos) (`xcode-select --install`); a full Xcode installation also works.
On Linux, install [Tauri's system dependencies](https://v2.tauri.app/start/prerequisites/#linux), including a C/C++ compiler, pkg-config, GTK 3, WebKitGTK 4.1, and OpenSSL development libraries.
`make setup` prepares JavaScript dependencies and repository hooks; it does not install Rust or OS development libraries.

Run from the clone or worktree root to build for the current host:

```sh
make setup
make standalone
```

`make standalone` builds shared packages, then Tauri builds the frontend and native release application.
On macOS it creates an `.app`; on Linux it creates the executable without packaging, following the existing Linux CI build.
This builds for the current host, not a different OS; Windows and other hosts are not supported by this application yet.

| Host | Output | Launch from the repository root |
| --- | --- | --- |
| macOS | `packages/standalone/src-tauri/target/release/bundle/macos/PFDSL.app` | `open packages/standalone/src-tauri/target/release/bundle/macos/PFDSL.app` |
| Linux | `packages/standalone/src-tauri/target/release/pfdsl-desktop` | `./packages/standalone/src-tauri/target/release/pfdsl-desktop` |

Linux needs a graphical desktop session to launch the application.
Save and Save As remain disabled on Linux; the shared build entry does not add platform features.
See [Linux verification](#linux-verification) and [application behavior](#application-behavior) for the feature and packaging limits.
The target preserves your PATH and appends `${CARGO_HOME:-$HOME/.cargo}/bin`, so an existing rustup installation is found even when your shell has not loaded Cargo's environment.
If `cargo metadata` reports `No such file or directory`, check `cargo --version` and `rustc --version` after running `. "$HOME/.cargo/env"` (or your custom Rust environment setup).
Missing or unusable Rust stops the target with a prerequisite link before compiling packages.

Start the native development application with Vite hot reload and Tauri's Rust rebuilds:

```sh
make standalone MODE=dev
```

This builds shared packages once, starts the frontend server, and opens the development app.
Stop it with `Ctrl+C`; after changing shared packages, restart this command to rebuild them.
The same command works on macOS and Linux; Xcode is checked only on macOS.
Linux AppImage packaging remains a separate verification step in [desktop CI](../../.github/workflows/desktop.yml), not part of this target.

The workspace pins a [Monaco 0.57.0 patch](../../patches/monaco-editor@0.57.0.patch) that prefers actual DOM focus when choosing the active editor.
This prevents delayed blur notifications from sending Quick Input commands to another tab.
When updating Monaco, recheck the patch and run the unit tests plus `node packages/standalone/test/goto-line-browser.mjs` after building shared packages.
The browser check requires an installed Chrome and checks Chromium only; native acceptance remains separate.

Rust/Cargo, the OS development libraries, and Node/pnpm are developer build requirements.
They are separate from the eventual installation requirements for distributed users.
The macOS CI job compiles an Apple Silicon app, runs native unit tests, and briefly starts the bundled executable to check native startup and exit-guard installation.
The startup smoke does not certify GUI, IME, or Quit interaction.

## Editing PFDSL

Click anywhere inside a diagram node, or focus it with Tab and press Enter, to open **Connections**; right-click also works.
A single click waits briefly for a possible double-click and preserves the diagram's pan; Enter and right-click open Connections immediately.
Dragging pans without opening Connections, and Cmd/Ctrl+click retains location and subflow navigation.
Selecting a neighbor updates the diagram, Connections and editor cursor while keeping focus in Connections.
Any editor cursor change, including keyboard, mouse, Go to definition and search navigation, updates the diagram and an open Connections panel without taking editor focus or opening a closed panel.
Applying a preview edit keeps the panel on its current node.
Artifacts have square outlines and processes have rounded outlines; feedback connections use dashed gray lines.
Opening Connections with the pointer preserves focus; opening from a node with Enter focuses the first heading action without showing candidates.
Focus or click a **Connect a node…** input to browse available candidates by ID or label, then use the arrow keys and Enter to connect one.
Unavailable and already connected candidates are hidden; a feedback candidate appears when a normal input would create a cycle.
After connecting a candidate, focus stays in the input and the refreshed candidates remain open.
Use the adjacent **+** to connect a new ID without adding a frontmatter definition or label; pressing Enter does not create a node.
Click or right-click a connection line to open its menu beside the line; use arrow keys to choose an action and Escape to return to the line.
Output connections offer **Delete** only; input connections offer **Make feedback** or **Remove feedback** when the switch is valid.
After deleting or switching a connection, focus stays near that connection on the same side and candidates stay closed.
Double-click a node or use **Go to definition** in Connections to move to its definition and focus the editor; undefined nodes offer **Create definition** instead.
**Create definition** adds an empty label and focuses the editor with the cursor inside its quotation marks, ready to type.
Use **Fit** to see the whole diagram or **Actual size** to restore 100%; the zoom display shows the current scale.
Select a node and use **Focus selected node** to center it at 100%, or smaller when needed to fit the diagram viewport. Groups are not supported by this action.

The source editor highlights YAML frontmatter and PFDSL flows.
Hover a node ID for its metadata, **Go to definition**, and **Find all**.
Find all opens a literal text search; PFDSL occurrence navigation visits the definition key and semantic node references.
Right-click in the editor or press F1 to find **Go to PFDSL definition**, **Next PFDSL node occurrence**, **Previous PFDSL node occurrence**, **Insert PFDSL definition**, and **Sort metadata…**.
Sort metadata accepts multiple keys in priority order; Cancel or Escape returns to the editor without changing the source.
Press Ctrl+G, or choose **Go to Line/Column...** from F1, to enter a line and optional column (for example, `:3:2`).
Enter confirms the position; Escape restores the starting position without editing the document.
Line and column values outside the document are clamped using Monaco's standard navigation rules.
Definition insertion writes `label: ""`, places the cursor inside the empty quotes, and retains the reminder to complete criteria for a produced artifact.
Each successful source edit is undoable.
The **Run in Terminal.app** inlay hint shows the declared process command; displaying or hovering it does not execute it.
Native GUI, keyboard, and Japanese IME acceptance for these features is tracked separately in the [acceptance plan](ACCEPTANCE-PLAN.md).

## References, comparison and process commands

Command-click `location` or `subflow` values, use their source hover links, or Command-click preview nodes to follow references.
PFDSL files open in application tabs, other files in their default application, and HTTP/HTTPS URLs in the default browser.
Directories offer a file chooser when several candidates exist; Cancel or Escape leaves the source unchanged.
Relative locations and process working directories use the document directory plus a relative `basePath`; absolute `basePath` is ignored, matching VS Code.
Subflows always resolve relative to the document directory.
Save an untitled document before opening relative references or running a command.

Use F1 or the editor context menu to **Compare structure with file…**, **Compare structure with Git ref…**, or **Clear structural comparison**.
The baseline label and direction appear beside the preview; comparison includes metadata and follows the current unsaved source without changing its Undo history.
Git comparison uses the saved document's repository and Git on the application's PATH; a missing Git installation does not disable file comparison or editing.

Place the cursor on a process and choose **Run process command in Terminal.app** or **Run process command in Ghostty**, or activate the inlay hint for Terminal.app.
Commands run only after this explicit action, in a new terminal using `/bin/zsh -l -c` and the terminal's normal login environment.
The application does not forward its environment or secrets, monitor completion, or update progress from exit codes.
macOS may request Automation permission for the selected terminal; denial or a missing terminal is reported without changing the document.

## Exporting

Press F1 or open the editor context menu to **Export as DOT…**, **SVG…**, **PDF…**, **PNG…**, **TSV…**, or **Export All (DOT, SVG, PDF, PNG, TSV)…**.
Choose a base file name and destination, then confirm replacement of existing outputs before any file is written.
Each export captures the current unsaved source and saved preset dependencies once, and produces the whole graph regardless of preview zoom, pan, focus, or structural comparison.
Export does not change the source, dirty state, or Undo history.

Results list each format's saved path, warning, conversion failure, or write failure.
Successful files remain when another format fails.
Results remain available after switching or closing the originating tab until dismissed.
Canceling a pending chooser writes nothing; after writing starts, the captured export finishes independently of tab selection.
If a destination changes during publication, the result explains that publication happened but its saved path or content could not be confirmed.

SVG comes from the bundled Graphviz WASM renderer, PNG from canvas, and PDF from a separate native WebKit view.
No Node.js, Graphviz, Puppeteer, or separate browser installation is required by the desktop application.
SVG viewBox units are treated as CSS pixels; PNG uses their ceiling in pixels with an opaque white background, independently of display density.
PDF scales each unit to 72/96 points and rounds each page dimension upward to whole points, preserving the full diagram on one page and retaining text.
Dimensions over 32768 units are rejected for PDF/PNG, and PNG also rejects canvases over 64 megapixels rather than silently shrinking or clipping.
Exact application, external viewer, font fallback, minimum OS, and All-format acceptance remain tracked in [GUI-34–36](ACCEPTANCE-PLAN.md).

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
make standalone
```

The [no-bundle option](https://v2.tauri.app/reference/cli/#build) skips packaging while building the frontend and native executable.
It does not require changing the macOS bundle configuration or creating AppImage, deb, or rpm packages.
With the default Cargo target directory and no explicit `--target`, launch the resulting executable:

```sh
packages/standalone/src-tauri/target/release/pfdsl-desktop
```

For iterative work in the graphical session, use `make standalone MODE=dev` instead.
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
After that job succeeds, download its `pfdsl-linux-x64-<source-commit>-attempt-<run-attempt>` artifact from the workflow run.
The attempt suffix keeps earlier artifacts when a job is rerun; choose the producer attempt you intend to verify.
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

The same job also packages a verification-only [AppImage](https://v2.tauri.app/distribute/appimage/) and uploads `pfdsl-linux-appimage-x64-<source-commit>-attempt-<run-attempt>`.
This is an Actions artifact for acceptance work, not a signed release.
The job extracts the built image and requires `libwebkit2gtk-4.1.so.0`, `libjavascriptcoregtk-4.1.so.0`, `libGLESv2.so.2`, and its GL dispatch library inside it before uploading.
GLES is explicitly included because libraries loaded at startup with `dlopen` can be absent even when the native executable's `ldd` output resolves every dependency.
An independent Debian 13 CI job without system WebKitGTK or GLES checks the native executable's linked dependencies and performs a GLES `dlopen` and symbol lookup using the extracted bundle.
It downloads the producer's artifact ID, so rerunning only the runtime job keeps using the successful producer's artifact.
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
test -f usr/lib/libGLESv2.so.2
test -f usr/lib/libGLdispatch.so.0
LD_LIBRARY_PATH="$PWD/usr/lib:$PWD/usr/lib/x86_64-linux-gnu:$PWD/usr/lib64" \
  ldd ./usr/bin/pfdsl-desktop
LD_LIBRARY_PATH="$PWD/usr/lib:$PWD/usr/lib/x86_64-linux-gnu:$PWD/usr/lib64" \
  ldd ./usr/lib/libGLESv2.so.2
```

Record any `not found` or version error and stop before GUI/corpus acceptance if dependencies remain unresolved.
This library-path check is a preflight; launching through `AppRun` also supplies the bundled GTK/WebKit resources and environment.
Neither `ldd` nor the CI GLES load check covers every dynamically loaded dependency or validates the target graphics driver.
When preflight succeeds, run `./AppRun` from the extracted directory for folder selection, cancellation, and dirty-close checks.
If startup reports a missing library or aborts before showing a window, record the full output and exit status, then stop GUI/corpus acceptance without installing packages or adjusting launch settings.
Do not launch `usr/bin/pfdsl-desktop` directly for these checks.

For corpus preparation, build the JS workspace at `SOURCE_COMMIT` and compare the archive's `frontend/` hashes with the checkout's standalone `dist/` first.
Pass `/absolute/new/appimage-verification/squashfs-root/usr/bin/pfdsl-desktop` to `prepare-native.mjs`, then run `PFDSL_ACCEPTANCE_ROOT=/absolute/new/corpus ./AppRun` from the extracted directory.
Preparation must hash the inner native executable because the native host fingerprints the running executable; the outer AppImage and `AppRun` have different hashes.
Record the outer AppImage and inner executable hashes separately.
An AppImage dependency check does not certify folder dialogs, GUI interaction, or native corpus acceptance.

## Application behavior

Each tab pairs its editor and preview.
The source is on the left and the diagram on the right, initially sharing the available width equally.
Drag the divider, or focus it and use Left/Right (Shift for smaller steps), Home or End, to adjust the widths without recreating either pane.
When no document is open, choose **New**, **Open…**, or **Try a sample**; the sample is opened only on request and is not saved to a file.
Use the native **File**, **Edit**, **View** and **Window** menus for document commands, formatting, diagram controls and tab navigation.
Choose **File > Open Folder…** to show the optional folder sidebar and open files as additional tabs.
The sidebar button and **View > Show/Hide Sidebar** toggle that folder view; recent files and folders are under **File > Recent**.
Format is an Undoable editor operation, and editor/node navigation uses the shared source positions.
Choose **View > Normalized edges** to inspect the active tab’s current text without editing it.
The read-only result uses the same edge sorting and serialization as the VS Code command; errors block the output, while warnings do not.
Result messages belong to their tab: an empty edge set shows `No normalized edges.`, and blocked output shows `Fix errors before normalizing.`.
Editing clears the previous result; run the action again to refresh it.
Each tab retains its own result, and **Close** or Escape within the panel dismisses it.
Choose **Edit > Format > Format flows** for per-process grouped flows or **Format flat** for one edge per line.
The shared formatter preserves chains containing internal comments as written, including in Flat mode.
Each action formats the active tab's current text as a whole document; selecting text does not limit the operation to that selection.
The action leaves text that produces formatting errors or text already in the chosen canonical format unchanged.
For selected text, use **Format selection (Flows)** or **Format selection (Flat)** in the editor context menu (Shift-F10), or open the editor Command Palette with F1.
With multiple selections, these actions format only the primary selection, matching the existing extension command.
Selection formatting expands to complete body lines and includes the selection's ending line, even when its end is at column one.
A selection confined to frontmatter or an unclosed frontmatter block is left unchanged.
The existing shared range formatter skips full-graph validation, preserves internally commented chains, and leaves selected text unchanged on formatting errors or canonical no-ops.
These actions leave the menu's whole-document Format behavior unchanged.
Native selection mapping, keyboard focus, and Undo/Redo remain to be checked in the current application.

PFDSL editors support square-bracket and double-quote pairing and surrounding selected text.
Use **Toggle Line Comment** from the editor Command Palette (F1), or Command-/ on macOS, to add or remove `#` on selected lines.
Syntax highlighting now distinguishes YAML frontmatter and PFDSL flows; string-aware quote suppression remains unimplemented, so quote pairing cannot distinguish existing strings yet.
Word lookup uses the extension's shared Unicode pattern: letters, numbers, underscores and hyphens form a word, including Japanese and supplementary-plane letters.
The pattern also permits a standalone hyphen; it is not a PFDSL tokenizer.
Automated checks cover real Monaco word ranges and the shared regex; native selection gestures and VS Code UI behavior remain unverified.
These language-support changes have automated editor checks; native keyboard and IME acceptance remain unverified in this candidate.

The native host holds a directory capability for each folder explicitly selected for that session.
Reads stay bound to that directory when its pathname is replaced; relative traversal and symlink escape are rejected.

Choose **File > New**, **File > Open…**, or **File > Recent** to work with documents.
Document names appear in tabs and the window title, while the header shows the current state and location.
The location stays on one line and truncates long paths with an ellipsis; its title contains the full path, and the text remains selectable and copyable.
Same-name tabs include their parent folders, and completed save messages name the document they belong to.
**Save** (Command-S) and **Save As…** (Command-Shift-S) are manual operations; there is no autosave or session restoration.
The recent list stores targets only, never editor content.
Closing a dirty tab or window, or using macOS Command-Q, the application Quit menu, or Dock Quit, enters the same Save, Discard, and Cancel transaction.
Native requests are cancelled immediately and exit is requested only after every document accepts; logout/shutdown may therefore be cancelled rather than resumed.
The guard does not protect against Force Quit, crashes, or power loss.
Owner-performed macOS Quit acceptance is recorded in [ACCEPTANCE.md](./ACCEPTANCE.md).
A cancellation, failed save, unreadable disk state, changed tab membership, or edit during the close sequence preserves unconfirmed buffers; earlier successful saves remain on disk.
Close finishes disk reads already in progress, starts fresh reads before decisions, and checks every target again after the last decision before disposing tabs.
Every unresolved target is read, the document's own file and any failed Save As target alike (including for an Untitled document), and one target failing to read never skips another.
An unreadable former disk version makes its surviving editor content require confirmation.
A decision applies only to the editor and disk state the application observed when it requested confirmation; a changed observed version requires a new decision.
A Save decision also covers only the text shown when it was asked, so text that changes after that is not saved without a new decision.
When that Save succeeds, closing continues in the same attempt and checks the saved state before disposing the tab.
Background disk polling pauses while confirmation is open, but the final checks reject the close if an observed version changed.
External changes after those final reads are not excluded atomically; Discard leaves the disk file unchanged.

Clean external changes reload automatically; dirty changes, deletion, and publication conflicts keep the editor content for review.
A change that leaves the file's content identical (a touch, a permission change, or a replacement with the same bytes) is not treated as a disk change.
The conflict panel identifies the recovery target and lets you compare its observed contents, choose another destination, or explicitly load the current disk version.
The panel names the recovery target by the path it was last observed at, and compares against the same snapshot its buttons act on.
A failed read of a tracked target is remembered the same way whichever action saw it: the background check, Save, a close or Use Current Disk Version.
Every Save inspects its target first.
A clean editor reloads a changed version instead of saving over it, while a tab that shows unsaved state is never reloaded by Save.
When the target's contents differ from the editor, replacing a disk version the document has not acknowledged, or a file picked in the chooser, always shows a review that compares the editor with that fresh inspection.
Replace sends the text and revision the review showed, and if the document or the observed disk version changes while the review is open the save is not sent.
Save As rejects a target already open by selected directory/leaf binding.
Distinct hard-link names are separate tabs and save targets; saving atomically replaces only the selected name.
External reloads acknowledge the text applied by Monaco, which normalizes mixed line endings to a single style; reloading or closing a clean tab does not rewrite the disk file, while a manual save writes the normalized editor text.
After a failed Save As, the original document remains active until a target is successfully saved or explicitly adopted.
Adoption refuses a target already open in another tab; both local buffers remain available.
Explicitly reopening a renamed file with the same inode updates its native capability and dependency base while retaining dirty content only after a fresh inspection confirms that the old selected name is missing; native parent-inode/leaf bindings keep source recovery separate from other Save As targets.

On macOS, a save checks the selected directory and disk revision, stages and synchronizes content in that directory, checks again, then atomically replaces the file (or exclusively creates a new one).
A detected external change stops the save and preserves editor content for review.
Saving identical content after the initial checks does not replace the file or create a temporary file.
Successful saves do not retain previous disk objects; unpublished temporary files are removed on failure, with a status message if cleanup fails.
A new file follows the process umask, while an existing file keeps its mode, owner, and protection.
Publication can succeed before a later conflict or read error is reported; inspect the current target before retrying.
The guarantee ends at the final pre-save check: an external write after that check can be overwritten, and later writes through an old file descriptor are not recovered.
Deliberate manipulation of the application's exclusive temporary names is outside this guarantee.
This is not an atomic compare-and-swap, backup history, crash-recovery, or power-loss durability guarantee.
On other operating systems, Save and Save As are disabled before opening a save dialog, with a persistent explanation.
Saving remains disabled while native support is being checked or if that check fails; shortcuts and recovery actions follow the same rule.
Native save requests and save-target selection are also refused before creating or writing a temporary file.
Dirty close offers Keep Editing, Discard and Cancel when saving is unavailable.
Keep Editing is the first button, and Cancel remains the dismissal action; only an explicit Discard discards editor content.
In browser-only mode, saving is also disabled with an explanation to use the desktop application.
The native document I/O boundary selects the macOS backend or an explicit read-only backend at compile time.
The read-only backend verifies the originally selected directory path and refuses inspection if that path is moved or replaced; it does not follow directory moves.
Its opaque revision token includes file identity, modification time and content hash, with an explicit unsupported protection marker; it does not detect protection-metadata changes.
Linux saving remains a separate product decision; Windows is outside the supported build targets.

The #1258 document-editing candidate remains under validation.
Existing-file saving keeps the FD obtained by exclusive stage creation and copies metadata with the operating system's `fcopyfile` facility.
It verifies owner/group, mode, protection flags, and extended ACL before writing editor content into the temporary file, and again after writing.
Content is written after stat metadata is copied, so the saved file receives the write's modification time.
An existing TextEncoding declaration is updated on the stage to describe the UTF-8 bytes actually written; files without that declaration do not acquire one.
Other metadata follows the system copier's behavior; creation time and every extended attribute are not independently restored or compared.
Copy or protection verification failures refuse publication, without a destructive fallback.
Selected-directory moves, deletion, replacement, and observed target content or protection changes are checked before publication.
A publication followed by an error retains a failure receipt and dirty buffer; an unreadable result is not represented by an old snapshot, and an IPC failure reports publication as unknown.
Native document capabilities are released when tabs close, selections are superseded, or Save As targets are canceled or rejected; unresolved Save As targets remain available until resolved or closed.
The exact bundle and nontrivial ACL/ownership and inherited ACL behavior still require acceptance; this is not proof of all-attribute preservation.
Its current native GUI, Japanese IME, Find/Replace, Undo/Redo, and manual-save interactions still require acceptance on the exact bundle; see the appended [validation record](ACCEPTANCE.md).
The language features above have automated Monaco checks and still require native acceptance in the [acceptance plan](ACCEPTANCE-PLAN.md).
External navigation and process commands have automated checks and still require native acceptance in the [acceptance plan](ACCEPTANCE-PLAN.md).
Export has automated checks and still requires native application acceptance in the [acceptance plan](ACCEPTANCE-PLAN.md).
Distribution remains tracked separately in the [acceptance matrix](ACCEPTANCE.md).
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
