#!/usr/bin/env node
/**
 * list-migration-candidates.mjs
 *
 * Prints the non-merge commits in an interval that touched distributed content, one `<hash> <subject>` per line. Release preparation classifies every one of them for docs/migration-guide.md; see .pfdsl/workflow.md「採用先への移行案内」.
 * The paths are built in scripts/lib/migration-candidates.mjs from DISTRIBUTION_ROOTS.
 *
 * Usage: node scripts/list-migration-candidates.mjs --from <rev> [--to <rev>]
 *   --from  previous release tag (v[0-9]*, lib-v*, or vscode-v*), exclusive
 *   --to    end of the interval, inclusive (default HEAD)
 *   exit 0 — listed (an empty interval prints nothing)
 *   exit 1 — git could not list the interval, e.g. an unknown revision
 *   exit 2 — the arguments were rejected
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	listMigrationCandidates,
	parseMigrationCandidateArgs,
} from "./lib/migration-candidates.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let interval;
try {
	interval = parseMigrationCandidateArgs(process.argv.slice(2));
} catch (error) {
	console.error(
		`error: ${error instanceof Error ? error.message : String(error)}`,
	);
	console.error(
		"usage: node scripts/list-migration-candidates.mjs --from <rev> [--to <rev>]",
	);
	process.exit(2);
}

try {
	process.stdout.write(listMigrationCandidates(interval, { cwd: root }));
} catch {
	// git has already written its reason to stderr.
	console.error(`error: could not list ${interval.from}..${interval.to}`);
	process.exit(1);
}
