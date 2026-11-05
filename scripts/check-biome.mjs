#!/usr/bin/env node
// Runs `biome check` as a gate that fails on a diagnostic of any severity
// (#747). biome's exit code covers errors, `--error-on-warnings` adds warnings,
// and info severity is covered by neither — see scripts/lib/biome-gate.mjs for
// why the verdict is taken from the diagnostic counts rather than from the
// severities the flags happen to reach.
//
// Every argument is passed through to `biome check` verbatim, so the callers
// keep spelling their own scope (`make lint` passes `.`, scripts/pre-commit
// passes `--staged --no-errors-on-unmatched`). No flag is interpreted here,
// which is why this script does not parse argv: an unknown flag is biome's to
// reject, not this wrapper's.
//
// Usage: node scripts/check-biome.mjs [biome check arguments...]

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateBiomeRun } from "./lib/biome-gate.mjs";
import { tryRun } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const biomeArgs = process.argv.slice(2);

// captureStderr keeps the reporter's "the --json option is unstable" notice off
// the terminal on the passing path, and out of the JSON this parses.
const result = tryRun(
	"pnpm",
	["biome", "check", ...biomeArgs, "--reporter=json"],
	{ cwd: root, captureStderr: true },
);
const verdict = evaluateBiomeRun(result);

if (!verdict.blocking) {
	// The passing path prints nothing from biome — the JSON report went to this
	// script rather than to the terminal — so say so, as the repo's other check
	// scripts do.
	console.log("check-biome: no diagnostics at any severity.");
	process.exit(0);
}

if (verdict.counts) {
	const { errors, warnings, infos } = verdict.counts;
	console.log(
		`Biome reported ${errors} error(s), ${warnings} warning(s), ${infos} info(s).`,
	);
}
if (verdict.reason) {
	console.log(verdict.reason);
}

// Re-run with the default reporter so the operator gets biome's own rendering —
// code frames and suggested fixes — rather than this script's retelling of it.
// Only on the failing path, so the common case stays a single biome run. Its
// exit code carries nothing the verdict lacks: it is the same command that
// produced the report, run again for its output.
const rendered = tryRun("pnpm", ["biome", "check", ...biomeArgs], {
	cwd: root,
});
console.log(rendered.out.trimEnd());

console.log(
	"Biome check failed. Run 'make format' to apply the mechanical fixes, resolve what remains, and re-stage.",
);
process.exit(1);
