#!/usr/bin/env node
// PreToolUse(Bash) hook: warns before a typecheck or test run that would
// read a build older than its sources (#642).
//
// Switching branches in the same checkout leaves dist/ as the previous
// branch built it, and `pnpm -r typecheck` resolves cross-package imports
// through those declarations — so a reference added on the new branch can
// pass locally and fail in CI, which builds first. This lived as a sentence
// in the roadmap companion, where it only helped whoever happened to read
// it at the right moment; the check belongs where the mistake is made.
//
// Advisory only. It prints to stderr and always exits 0: reading a stale
// build deliberately is normal while debugging, and a guard that blocked
// here would be wrong as often as it was right. A crash must not wedge every
// Bash call either, so anything unparseable is let through in silence.
//
// Usage (wired in .claude/settings.json): node scripts/stale-dist-guard.mjs

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isDistStale } from "./lib/dist-freshness.mjs";
import { formatStaleWarning, stalePackages, trustsBuildOutput } from "./lib/stale-dist-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The packages whose dist/ other packages import through. */
const PACKAGES = [
	{ name: "@pfdsl/core", distFile: "packages/core/dist/index.js" },
	{ name: "@pfdsl/graphviz-exporter", distFile: "packages/graphviz-exporter/dist/index.js" },
	{ name: "@pfdsl/metadata-exporter", distFile: "packages/metadata-exporter/dist/index.js" },
	{ name: "@pfdsl/preview-engine", distFile: "packages/preview-engine/dist/index.js" },
	{ name: "@pfdsl/cli", distFile: "packages/cli/dist/cli.js" },
];

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
	input += chunk;
}

let payload;
try {
	payload = JSON.parse(input);
} catch {
	process.exit(0);
}

if (!trustsBuildOutput(payload?.tool_input?.command)) {
	process.exit(0);
}

const stale = stalePackages(
	PACKAGES.map((p) => ({ ...p, distFile: resolve(root, p.distFile) })),
	isDistStale,
);
const warning = formatStaleWarning(stale);
if (warning) console.error(`[pfdsl] ${warning}`);
process.exit(0);
