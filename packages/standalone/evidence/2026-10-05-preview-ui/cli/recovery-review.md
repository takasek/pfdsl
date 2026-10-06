# CLI recovery hint independent review

Scope: current HEAD → workingtree diff of `packages/cli/src/index.ts` and `packages/cli/src/meta-create.test.ts` only, with the unchanged argument parser/command consumer read for correctness.
The GUI observation report was frozen before reading this source.
No production files, Git metadata, or external state were changed.

Final re-review result: the option-boundary finding below is resolved in the current source and built CLI.
There are no remaining findings in this bounded CLI diff review.
The independently retained --json counterexample now passes (1 test), the focused source suite passes 33 tests, and actual built-CLI shell copy execution passes all 4 selected cases.

## Initial finding, resolved by the final change

**P2 — Recovery command still treats a dash-prefixed semantic ID as a CLI option.**
Anchor: `packages/cli/src/index.ts:1541`; argument quoting helper at `:1474`; unchanged CLI option parser at `:4029` and create consumer at `:4405`.
For a body-only process authored as `a >> "--json" -> b`, `meta set <file> '"--json"' label Prepared` returns this recovery command:

```sh
pfdsl meta create '/absolute/plan with spaces.pfdsl' --json --write
```

The POSIX shell preserves the argument correctly, but `parseNodeArgs` consumes `--json` as a flag, leaving no ID positional.
Running the recovered actual shell argument array through the current source `run` returns exit code 2 and meta create usage; the file is unchanged.
Quoting a string beginning with `-` does not protect it from option parsing.
The emitted command needs an option boundary, for example `meta create --write -- <file> <id> [status=todo]`, with the file/ID still shell-quoted.
The same boundary is relevant to dash-prefixed relative filenames.

This is an incomplete copyability guarantee, rather than a shell injection: the newly added POSIX quoting correctly handles the tested spaces, apostrophes, quotes, substitutions, backticks, semicolons, glob characters, and backslashes.
The added fixtures start each semantic ID with `release` and use absolute temp paths, so they do not exercise this option boundary (`packages/cli/src/meta-create.test.ts:348`).

## Executed validation

- The existing focused source suite, `meta-create.test.ts`, passes **32 tests** through Vitest 1.6.1.
- An independent disposable test imports the current CLI source, obtains the recovery hint, executes it through `/bin/sh` with a temporary pfdsl argument-capture function, and sends the exact captured arguments to `run`.
- The independent dash-ID expectation of exit 0 fails with actual exit 2 (**1 failed test**), reproducing the finding.
- The temp fixture is removed in `finally`; the standalone test/config remain under `/private/tmp` for reproduction.
- Roadmap artifact `status=todo` hint and resulting definition are exercised by the passing added space/shell-special cases.

Focused suite command:

```sh
node packages/cli/node_modules/vitest/vitest.mjs run --root <checkout>/packages/cli --config <checkout>/packages/cli/vitest.config.ts src/meta-create.test.ts --reporter verbose
```

Counterexample command:

```sh
node packages/cli/node_modules/vitest/vitest.mjs run --config <temporary>/pfdsl-cli-recovery-review-01a10a12.config.mts --reporter verbose
```

Counterexample files: `<temporary>/pfdsl-cli-recovery-review-01a10a12.test.ts` and `<temporary>/pfdsl-cli-recovery-review-01a10a12.config.mts`.

Only the requested CLI diff and its immediate consumer were reviewed.
No full suite, other shell dialect, Windows shell, or packaged CLI distribution was checked in this separate review.

## Final independent recheck

The final hint places `--write --` before file, semantic ID, and optional initial fields.
The shell quoting remains applied to file and semantic ID.
This preserves the CLI option boundary and the literal POSIX argument boundary together (`packages/cli/src/index.ts:1541`).
The previously failing source fixture `a >> "--json" -> b` now produces a process definition with label --json and exits 0 after copying the actual hint through `/bin/sh`.
Only the temporary test's command-extraction regex was broadened to accept the changed flag order; its fixture and success assertion are unchanged.

The focused current-source suite has 33 passing tests, including the added option-like ID case and the prior space/quote/shell-special cases.
An independent actual-built-CLI script obtains each JSON recovery hint, defines a shell pfdsl function that invokes this exact built `cli.js` with `"$@"`, and executes the copied hint through `/bin/sh`.
This uses the real CLI command dispatcher rather than only replaying captured arguments into the source API.

| Actual copied built CLI command case | Result |
| --- | --- |
| File and artifact ID containing spaces | Exit 0; exact label retained; roadmap status todo |
| File and process ID containing apostrophes and double quotes | Exit 0; exact semantic ID/label retained |
| File and roadmap artifact ID containing $, command substitution, backticks, semicolon, glob characters, and backslash | Exit 0; exact label retained; status todo; no marker files created |
| Relative file `-plan with spaces.pfdsl` and semantic process ID `--json` | Exit 0; literal file/ID retained |

Source and built asset fingerprints for this actual run:

```text
packages/cli/src/index.ts 6a2eb43417811694e0449f5a9af872c5b96ceb7d5ddfdb930c9cd7142c9e4f26
packages/cli/src/meta-create.test.ts d52c7fd545151cc2c2f29aec2b24a71155d9dafd0ee63e185afb21806f98e7d5
packages/cli/dist/cli.js b433c92ce8d09f0742e36f6c22221ef765a885a0c280f961a2a49fe3e9c4b007
packages/cli/dist/index.js 87fd81c9508dd36ae762b00ba048f63e91be406237b38b9a0d289df77ec51160
```

The built replay driver and detailed command/source/metadata results are `<temporary>/pfdsl-cli-recovery-built-01a10a12.mjs` and `<temporary>/pfdsl-cli-recovery-built-01a10a12.json`.
All disposable test fixture directories were removed; each command completed synchronously with no owned process left running.
No source/Git/publication operation was performed by this reviewer.
The GUI report remains frozen and is not supplemented by this CLI re-review.
