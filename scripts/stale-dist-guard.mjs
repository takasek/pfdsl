#!/usr/bin/env node
// PreToolUse(Bash) + PostToolUse(Bash) hook: warns about a typecheck or test
// run that reads a build older than its sources (#642, #650). See
// scripts/lib/stale-dist-guard.mjs for the detection logic, for why the same
// check runs on both events, and for the stdin orchestration.
//
// Always exits 0: anything unparseable is let through in silence, since a
// crash here must not wedge every Bash call.
//
// Usage (wired in .claude/settings.json): node scripts/stale-dist-guard.mjs

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isDistStale } from "./lib/dist-freshness.mjs";
import { readStdinText } from "./lib/hook-io.mjs";
import { runStaleDistGuard, stalePackages } from "./lib/stale-dist-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The packages whose dist/ other packages import through. */
const PACKAGES = [
	{ name: "@pfdsl/core", distFile: "packages/core/dist/index.js" },
	{ name: "@pfdsl/graphviz-exporter", distFile: "packages/graphviz-exporter/dist/index.js" },
	{ name: "@pfdsl/metadata-exporter", distFile: "packages/metadata-exporter/dist/index.js" },
	{ name: "@pfdsl/preview-engine", distFile: "packages/preview-engine/dist/index.js" },
	{ name: "@pfdsl/cli", distFile: "packages/cli/dist/cli.js" },
];

const findStale = () =>
	stalePackages(
		PACKAGES.map((p) => ({ ...p, distFile: resolve(root, p.distFile) })),
		isDistStale,
	);

const { shouldOutput, output, stderr } = runStaleDistGuard(await readStdinText(), { findStale });
if (shouldOutput) console.log(JSON.stringify(output));
if (stderr) console.error(stderr);
process.exit(0);
