# Linux Inspector diagnosis

This is a separate diagnostic build for the remaining PR #1411 checks.
It does not replace the accepted AppImage or certify the remaining GUI conditions.
The [returned diagnosis](inspector-results/README.md) records the completed run, primary evidence and remaining product/environment boundaries.

## Build identity

The `linux-inspector` workflow runs only for PR #1411 in `takasek/pfdsl`.
It checks out product source `8261f877d5cae8aa653a5310edfbd9e387acb116`, independently of the workflow revision, and uses its existing dependency locks and frontend.
It builds a release executable with the command below, in a separate Cargo target directory.
The normal desktop workflow and the product Cargo manifest, frontend and CSP are unchanged.

```sh
pnpm --filter @pfdsl/standalone tauri build --no-bundle --features tauri/devtools -- --locked
```

The Tauri [release Inspector feature](https://v2.tauri.app/develop/debug/) enables the normal WebKit Inspector without selecting a debug Rust profile.
The CLI feature is limited to this build invocation.
The diagnostic binary includes Tauri's Inspector support and may differ from the accepted native binary in other build-environment-dependent bytes; both build environments are recorded.

The job downloads accepted artifact `11461844652` from run `37574418253`, verifies its metadata and known AppImage/native hashes, and requires identical frontend file sets and all ten SHA256 values.
It records both lock hashes before and after building, the resolved Cargo feature tree, all AppDir entry differences including type/mode/link target, the product source and immutable workflow commit, and both build environments.
New artifacts are named `pfdsl-linux-inspector-x64-8261f877d5cae8aa653a5310edfbd9e387acb116-<run-id>-attempt-<run-attempt>` to preserve earlier attempts.
The previously inspected artifact `11525926292` retains its original name without the attempt suffix.
Its archive contains `PFDSL-Inspector.AppImage`, `frontend/`, `SOURCE_COMMIT`, `DIAGNOSTIC_BUILD.json`, `source-locks.txt`, `build-environment.txt`, `accepted-build-environment.txt`, `cargo-features.txt`, `APPDIR_SHA256SUMS`, and `SHA256SUMS`.
GUI Inspector availability and Monaco model access are explicitly recorded as unverified by CI.
An expired or mismatched baseline artifact stops this job; it does not silently use a different product version.

## Verify before diagnosis

Obtain the artifact from the expected repository and run, check its ZIP digest against GitHub metadata, and inspect ZIP/tar paths and links before extracting into a new directory.
Verify `SHA256SUMS`, product source, build identities, lock hashes, all frontend hashes and the AppDir differences.
Inspect and explain the file differences against the accepted build before attributing any behavior difference solely to Inspector support.
The new AppImage/native hashes identify the diagnostic binary; they are not expected to equal the accepted binary hashes.

```sh
./PFDSL-Inspector.AppImage --appimage-extract
cd squashfs-root
sha256sum -c ../APPDIR_SHA256SUMS
export LD_LIBRARY_PATH="$PWD/usr/lib:$PWD/usr/lib/x86_64-linux-gnu:$PWD/usr/lib64"
ldd usr/bin/pfdsl-desktop
ldd usr/lib/libGLESv2.so.2
./AppRun
```

Stop if a runtime dependency is unresolved.
Use the ordinary folder picker and a disposable copy of the same fixture.
Use the normal context-menu Inspect command or Ctrl+Shift+I and verify Elements, Computed, Console and Sources actually work.
An empty Inspector window, menu entry or successful build alone is insufficient.

## Read-only observations

For each normal hover-click/editor-selection operation, record the target node's class changes, matched selectors, computed filter/outline/animation and the native frame's actual reduced-motion media query.
Read-only mutation observation can timestamp class changes; record the observation script and its overhead separately from the ordinary capture.
Do not change CSS, classes, media-query overrides, timers, application code or sandbox/rendering flags.
Separate absent classes, unmatched CSS, ineffective computed styles and computed styles without visible paint instead of assigning a cause from missing pixels alone.
Inspect the ordinary redraw after a meaning-preserving edit and record adoption of its new SVG; resize or a changed raster alone is not this evidence.

For CRLF, reach the actual Monaco model through normal Inspector Sources/scopes and read `getEOL()` and `getValue()` as JSON without newline replacement before Create definition, after creation, after Undo and after Redo.
Do not assume `window.monaco` or a global `getModels()` API exists in the optimized ESM frontend.
If the model is inaccessible, report that specific limit; do not add a global export and call the frontend identical.
Debugger pauses can change cue timing, so paused observations are diagnostic evidence, not proof of the normal cue deadline.
No Save or individual tab-close UI is required or added.

## OS setting and restoration

The earlier GNOME animation change restored effective true/type b but did not preserve the original override's presence.
Do not reset that unknown historical baseline by guessing.
For any next authorized temporary animation change, record the current value, type and override existence before changing it, and restore that exact current state afterward.
If those readings are unavailable, stop before mutation.
Identify the active XSettings manager and its supported normal setting route through read-only inspection first.
A successful xfconf/gsettings write is insufficient unless effective GTK and the actual webview media query change.
Do not replace the manager, directly rewrite its XSettings blob or introduce unrelated system changes.

Report diagnostic findings separately from the accepted artifact's historical matrix.
Any product fix needs its own source/binary identity and a subsequent ordinary native check; a diagnostic binary's success is not retroactive acceptance of the original binary.
