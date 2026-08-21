#!/usr/bin/env node
// PostToolUse(Write|Edit) hook: when prose lands in a `.pfdsl/*.md` companion,
// asks whether a mechanism could carry it and whether it belongs in the
// distributed layer instead (#922). See scripts/lib/companion-prose-advisory.mjs
// for why this is an advisory rather than a gate, and why it fires at write
// time rather than at the terminal gate.
//
// Always exits 0 — this never blocks anything.
//
// Usage (wired in .claude/settings.json): node scripts/companion-prose-advisory.mjs

import { runCompanionProseAdvisory } from "./lib/companion-prose-advisory.mjs";
import { readStdinText } from "./lib/hook-io.mjs";

const { shouldOutput, output } = runCompanionProseAdvisory(
	await readStdinText(),
);
if (shouldOutput) {
	console.log(JSON.stringify(output));
}
process.exit(0);
