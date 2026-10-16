# GUI acceptance execution index

This is a disposable input kit and blank result sheet for [the acceptance plan](../ACCEPTANCE-PLAN.md), not another procedure specification.
Current candidate identities and implementation evidence are in [the handoff](../ACCEPTANCE-HANDOFF.md); current assignments and blockers belong to [#1445](https://github.com/takasek/pfdsl/issues/1445).
Preparation rewrites those two links to file URLs in the source checkout; keep that checkout available and verify its plan version against the candidate registration.

Create a NEW directory, then open its copies only:

```sh
node packages/standalone/acceptance-kit/prepare.mjs /tmp/pfdsl-gui-1445-my-run
```

The command refuses an existing destination.
It copies the sample tree with its presets and references, adds small editable fixtures, records the current large sample's line count in `INPUTS.json`, and copies `RECORDS.csv` here.
No personal files or global settings are changed.
Use a different directory for another host or candidate.
The sheet starts with no new passes; split a row further if an observation differs within its variant.
Record OS/CPU/host version, source commit and dirty state, candidate hash, plan commit, actual result and evidence for each executed row.
Transfer results to the existing `ACCEPTANCE.md` and evidence, and current blockers to #1445.
Do not turn old failures into unexecuted rows or copy an old pass to this candidate.

| Order | Plan IDs | Ready input / execution note |
| --- | --- | --- |
| 1 | GUI-03, 06, 07, 08, 38 | `one/same.pfdsl`, `two/same.pfdsl`, the Japanese filename; `external/current.pfdsl` and `external/replacement.pfdsl` for independent disk replacement. Use `compare/long-base.pfdsl` / `long-current.pfdsl` for long lines and separated changes. |
| 2 | GUI-09–16, 19, 20, 22 | `neighbors.pfdsl`: p has a/b including feedback; q/c stay outside p's direct neighbors. `lone` is declared but isolated. Use `undefined.pfdsl`, `many.pfdsl`, `quoted-crlf.pfdsl` for missing definitions, scrolling and quoted/CRLF paths. For GUI-19 quoted definition creation start with `quoted-undefined.pfdsl` and create `"p p"` then `b` (produced artifact requiring criteria). Use a fresh copy after destructive edits. GUI-20 includes the editor QuickPick separately from Connections. |
| 3 | GUI-01, 02, 17, 18, 21, 25 | `wide.pfdsl`, `error.pfdsl`, `samples/01-simple-chain.pfdsl`, and `samples/pfdsl_implementation_flow.pfdsl`. Use the plan's representative widths, sidebar states, split positions and text enlargement. Keep the recorded extreme-width failure separate. |
| 4 | GUI-18, 26–29 | The copied samples and presets, `quoted-crlf.pfdsl`, `missing-extends.pfdsl`, `cyclic-a.pfdsl` / `cyclic-b.pfdsl`. `lexer-error.pfdsl` contains `@` (L002); delete it and insert `>>` to recover. `error.pfdsl` produces FM002. Delete the final target after `->` for parser error P007, then restore it. Renderer exceptions have a controlled automatic test; if the native condition cannot be produced, leave that variant unexecuted. |
| 5 | GUI-30–33 | `references/child.pfdsl`, `references/note.txt`, empty directory and sample subflows. In a copy of `neighbors.pfdsl`, set location to `references`, `references/empty`, a local PFD, or an HTTPS URL only when intentionally testing external opening. GUI-33's declared command only prints a disposable message; execute only through the plan's explicit action. |
| 6 | GUI-31 | `compare/base.pfdsl`, `metadata.pfdsl` (label only) and `edges.pfdsl`. Compare baseline to the unsaved current document and clear comparison. For Git, initialize only a copied `compare` directory as below. |
| 7 | GUI-34–36 | All copied samples, Japanese fixture, `wide.pfdsl`; use `output/` for export. For a partial write failure create only a disposable `output/test.png`, then `chmod 400` it; select basename `test` for All and restore with `chmod 600` afterwards. Do not change permissions on real documents or their parents. |
| 8 | GUI-35 | `oversize.pfdsl` is generated text, not a stored bitmap. Export SVG first and read viewBox W/H: confirm at least one dimension exceeds 32768 before expecting native PDF/PNG rejection. Otherwise increase the generated label or chain in this copy and remeasure. For V, Puppeteer absence is tested in an isolated host without installing that optional runtime; leave the variant unexecuted if that environment is unavailable. |
| 9 | GUI-04, 05, 23, 24, 37 | Native menu, actual IME/readout and clone/F5 operations follow the plan. This task does not change App Shortcuts, multiCursorModifier, reduced-motion or other personal settings. Record existing settings; variants requiring a setting change remain pending until the operator authorizes an isolated setup. |
| 10 | GUI-39–44 | Follow the plan and #1262 readiness. A local development `.app` does not satisfy signed/notarized DMG, minimum OS, installation/update, publication or prolonged-session acceptance. Linux is separate. |

Optional disposable Git baseline (replace the absolute path with your new run):

```sh
git -C /tmp/pfdsl-gui-1445-my-run/compare init
git -C /tmp/pfdsl-gui-1445-my-run/compare add base.pfdsl
git -C /tmp/pfdsl-gui-1445-my-run/compare -c user.name=Acceptance -c user.email=acceptance@example.invalid commit -m baseline
```

Open `compare/base.pfdsl`, edit its label without saving, and compare with `HEAD` per GUI-31.
For external modification, open `external/current.pfdsl`, edit its buffer, then copy `external/replacement.pfdsl` over the disk file outside the app.
Inspect both buffers and disk contents independently after cancel/adopt/replace.
To simulate deletion or rename, operate only on those disposable copies.
There is no delay switch or fault-injection API: if save/pending timing cannot be observed, record it as unexecuted and cite the controlled automated coverage separately.

Close the test documents and isolated hosts before deleting the run directory.
Restore any permissions changed inside it first; retain the completed sheet and evidence before removing inputs.
