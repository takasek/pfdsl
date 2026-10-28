#!/usr/bin/env node
// Adapter for the opt-in sweep workflow. Retention and verification belong
// to `pfdsl prune`; this script only resolves and invokes that CLI.
// Usage: node scripts/pfdsl/sweep-completed-chains.mjs <file> [--write]

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let file;
let write;
try {
	const { values, positionals } = parseArgs({
		options: { write: { type: "boolean" } },
		strict: true,
		allowPositionals: true,
	});
	if (positionals.length !== 1) {
		throw new TypeError(
			`expected exactly one positional argument (<file>), got ${positionals.length}`,
		);
	}
	[file] = positionals;
	write = values.write === true;
} catch (error) {
	console.error(`sweep-completed-chains: ${error.message}`);
	process.exit(2);
}

// An explicit override must resolve on its own; never silently fall back.
// Use package JavaScript, not the pnpm .bin shell wrapper, with node.
const candidates = process.env.PFDSL_CLI
	? [process.env.PFDSL_CLI]
	: [
			resolve(root, "packages/cli/dist/cli.js"),
			resolve(root, "node_modules/@pfdsl/cli/dist/cli.js"),
		];
const cli = candidates.find((path) => existsSync(path));
if (!cli) {
	console.error(
		"sweep-completed-chains: could not resolve the pfdsl CLI. Run 'pnpm -r build' in this repo, install @pfdsl/cli in an adopting repo, or set PFDSL_CLI to its JavaScript entry point.",
	);
	process.exit(1);
}

const probe = spawnSync(process.execPath, [cli, "prune", "--help"], {
	encoding: "utf8",
});
if (probe.status !== 0 || /unknown command/.test(probe.stderr ?? "")) {
	console.error(
		`sweep-completed-chains: the resolved pfdsl CLI (${cli}) has no usable 'prune' command. Upgrade to a release with 'prune', run 'pnpm -r build' in this repo, or set PFDSL_CLI to a build with 'prune'.`,
	);
	if (probe.error) console.error(probe.error.message);
	if (probe.stderr) process.stderr.write(probe.stderr);
	process.exit(1);
}

// The adapter's dry run requests a deletion report, while the CLI's default
// preview returns source. Forward both output streams and failures intact.
const result = spawnSync(
	process.execPath,
	[cli, "prune", file, "--json", ...(write ? ["--write"] : [])],
	{ stdio: "inherit" },
);
if (result.error)
	console.error(`sweep-completed-chains: ${result.error.message}`);
process.exit(result.status ?? 1);
