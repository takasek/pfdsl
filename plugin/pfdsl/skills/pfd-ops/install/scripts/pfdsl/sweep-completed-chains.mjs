#!/usr/bin/env node
// Sweeps completed chains out of a roadmap .pfdsl file (issue #1125).
// Usage: node scripts/pfdsl/sweep-completed-chains.mjs <file> [--write]
//
// Default is a dry run: it prints what it would delete and exits 0 without
// touching the file. Pass --write to apply the change. See the module doc in
// ./lib/chain-sweep.mjs for the retention rule this derives from.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { computeDeleteTargets } from "./lib/chain-sweep.mjs";
import { joinIdsForCliArg } from "./lib/cli-id-arg.mjs";
import { readyUnchanged } from "./lib/ready-compare.mjs";
import { scratchPathFor } from "./lib/scratch-path.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// node:util rather than a shared helper because this file is distributed to
// adopting repos, which have no scripts/lib/ — same constraint documented in
// audit-issues-flow.mjs.
let file;
let write = false;
try {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			write: { type: "boolean" },
		},
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
} catch (err) {
	console.error(`sweep-completed-chains: ${err.message}`);
	process.exit(2);
}

// --- Resolve the pfdsl CLI entry point ---
//
// PFDSL_CLI is an explicit override: when set, it must resolve on its own —
// a broken override fails loudly rather than silently falling back to
// whatever else happens to be on disk. Unset, the order is this repo's own
// build, then an adopting repo's installed package.
function resolveCli() {
	const envPath = process.env.PFDSL_CLI;
	if (envPath) return existsSync(envPath) ? envPath : null;

	const builtPath = resolve(root, "packages/cli/dist/cli.js");
	if (existsSync(builtPath)) return builtPath;

	// The package's own entry point, not `node_modules/.bin/pfdsl`. The CLI is
	// spawned as `node <path>`, which needs real JavaScript: npm writes that bin
	// entry as a symlink to this same file, but pnpm writes a `#!/bin/sh`
	// wrapper, and handing that to node fails with a SyntaxError naming a file
	// the reader never asked about.
	const installedPath = resolve(root, "node_modules/@pfdsl/cli/dist/cli.js");
	if (existsSync(installedPath)) return installedPath;

	return null;
}

const cliPath = resolveCli();
if (!cliPath) {
	console.error(
		[
			"sweep-completed-chains: could not resolve the pfdsl CLI.",
			"  In this repo: run 'pnpm -r build'.",
			"  In an adopting repo: run 'npm install --no-save @pfdsl/cli'.",
			"  Or set PFDSL_CLI to an absolute path to the CLI entry point.",
		].join("\n"),
	);
	process.exit(1);
}

/**
 * Runs `node <cliPath> <args>` and returns its result without throwing on a
 * non-zero exit — several steps below (input-sanity `check`, verification)
 * need to inspect a failing exit code and its output rather than treat it as
 * a script-level exception.
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runCli(args) {
	try {
		const stdout = execFileSync(process.execPath, [cliPath, ...args], {
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		});
		return { status: 0, stdout, stderr: "" };
	} catch (err) {
		return {
			status: typeof err.status === "number" ? err.status : 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? String(err.message ?? err),
		};
	}
}

/**
 * Runs the CLI and parses its stdout as JSON, folding a non-zero exit or a
 * parse failure into a single `ok: false` shape callers can check uniformly.
 * @param {string[]} args
 */
function runCliJson(args) {
	const result = runCli(args);
	if (result.status !== 0) return { ok: false, result };
	try {
		return { ok: true, value: JSON.parse(result.stdout), result };
	} catch (err) {
		return { ok: false, result, parseError: err };
	}
}

function failWith(message, result) {
	console.error(`sweep-completed-chains: ${message}`);
	if (result) {
		const detail = result.stdout || result.stderr;
		if (detail) console.error(detail);
	}
	process.exit(1);
}

// --- Step 1.5: capability gate — the resolved CLI must have 'delete' ---
//
// resolveCli() above only checks that a path exists, not what the binary
// there can do. A workflow that installs a published release can resolve a
// build that predates the 'delete' subcommand this script depends on
// throughout (the published @pfdsl/cli 0.0.26 and every version before it —
// verified via `npm view @pfdsl/cli version`/`dist-tags`, both 0.0.26, and
// `node .../cli.js delete --help` on that install reporting "unknown
// command: delete"). Left unchecked, that surfaces mid-run as an unrelated
// parse failure the first time a sweep target is found and 'delete' is
// actually invoked — this probe fails at startup instead, before Step 2 does
// any work, so it fires the same way whether or not this run has anything to
// sweep.
//
// `delete --help` is the probe because it is answered before the file/id
// positional arguments are validated (same as every other subcommand's
// `--help`), so it needs no target file and succeeds on any CLI build that
// has the command at all.
//
// The floor named below is a verified fact (0.0.26 lacks 'delete'), not a
// guessed "requires >= X.Y.Z": this repo's own packages/cli/package.json has
// not been bumped past 0.0.26 since 'delete' was added on this branch, so
// that number cannot be asserted as the next published floor without being
// wrong the moment someone reads it.
const deleteHelp = runCli(["delete", "--help"]);
if (deleteHelp.status !== 0 || /unknown command/.test(deleteHelp.stderr)) {
	failWith(
		[
			`the resolved pfdsl CLI (${cliPath}) has no 'delete' subcommand.`,
			"  A version of @pfdsl/cli newer than the published 0.0.26 is required",
			"  (0.0.26 and every version up to it lack 'delete').",
			"  In this repo: run 'pnpm -r build' so packages/cli/dist/cli.js is used.",
			"  In an adopting repo: upgrade to a released @pfdsl/cli with 'delete',",
			"  or set PFDSL_CLI to a build that has it.",
		].join("\n"),
	);
}

// --- Step 2: input sanity — a broken graph is not swept ---

const checkResult = runCli(["check", file]);
if (checkResult.status !== 0) {
	failWith(
		"'check' reported errors on the input file; refusing to sweep a broken graph.",
		checkResult,
	);
}

// --- Step 3: before snapshot — the exact stdout, compared verbatim later ---

const readyBefore = runCli(["status", "ready", file, "--json"]);
if (readyBefore.status !== 0) {
	failWith("failed to snapshot 'status ready' before sweeping.", readyBefore);
}
const blockedBefore = runCli(["status", "blocked", file, "--json"]);
if (blockedBefore.status !== 0) {
	failWith(
		"failed to snapshot 'status blocked' before sweeping.",
		blockedBefore,
	);
}

// --- Step 4: derive delete targets ---

const edgesRes = runCliJson(["graph", "edges", file, "--json"]);
if (!edgesRes.ok)
	failWith("failed to read 'graph edges --json'.", edgesRes.result);

const listRes = runCliJson([
	"status",
	"list",
	file,
	"--status",
	"todo,wip,waiting,suspended,done",
	"--json",
]);
if (!listRes.ok)
	failWith("failed to read 'status list --json'.", listRes.result);

const deleteIds = computeDeleteTargets({
	edges: edgesRes.value.edges,
	artifacts: listRes.value.items,
});

if (deleteIds.length === 0) {
	console.log("sweep-completed-chains: no sweep targets found.");
	process.exit(0);
}

// --- Step 5: apply the deletion to a scratch file next to the original ---
//
// The scratch file lives beside `file` (scratchPathFor), not under
// tmpdir(): `pfdsl check` resolves a relative `extends:`/`subflow:` from the
// file being checked's own directory, so verifying in some other directory
// can reject a candidate the real location would accept — or the reverse
// (#1125). The random token in the name avoids colliding with a concurrent
// run against the same file.
//
// Cleanup cannot live in a `finally` around this whole block: several steps
// below fail by calling process.exit() directly (via failWith), and
// process.exit() tears down the process without unwinding to a pending
// finally. So every exit point below calls cleanupScratch() itself, right
// before it fails or exits — the `finally` here only has to catch the path
// an unexpected thrown error takes, where normal unwinding still applies.
const scratchFile = scratchPathFor(file, randomBytes(6).toString("hex"));

function cleanupScratch() {
	rmSync(scratchFile, { force: true });
}

function failVerify(message, result) {
	cleanupScratch();
	failWith(message, result);
}

try {
	const deleteResult = runCli(["delete", file, joinIdsForCliArg(deleteIds)]);
	if (deleteResult.status !== 0) {
		failVerify("'delete' failed.", deleteResult);
	}
	writeFileSync(scratchFile, deleteResult.stdout, "utf-8");

	// --- Step 6: verification — nothing here may be skipped or summarized ---

	const verifyCheck = runCli(["check", scratchFile]);
	if (verifyCheck.status !== 0) {
		failVerify(
			"post-sweep 'check' reported errors; not applying.",
			verifyCheck,
		);
	}

	// A GITHUB_TOKEN-authored PR never triggers the pull_request workflow, so
	// this repo's own `make check-fmt` never runs against this script's
	// output — nothing outside this gate verifies it stayed canonically
	// formatted. `delete` only rewrites what it touches, so a non-canonical
	// input can pass its own `check` (which does not judge formatting) and
	// still come out non-canonical.
	const verifyFmt = runCli(["fmt", scratchFile, "--check"]);
	if (verifyFmt.status !== 0) {
		failVerify(
			"post-sweep output is not canonically formatted; not applying.",
			verifyFmt,
		);
	}

	const orphansRes = runCliJson(["graph", "orphans", scratchFile, "--json"]);
	if (!orphansRes.ok) {
		failVerify(
			"failed to read post-sweep 'graph orphans --json'.",
			orphansRes.result,
		);
	}
	if (orphansRes.value.orphans.length > 0) {
		console.error(
			"sweep-completed-chains: post-sweep 'graph orphans' is non-empty; not applying.",
		);
		console.error(JSON.stringify(orphansRes.value.orphans, null, 2));
		cleanupScratch();
		process.exit(1);
	}

	// Compared field-by-field via readyUnchanged, not as full output strings:
	// a corruption that drops an item from `ready`/`blocked` while leaving
	// every remaining id intact would pass an id-set comparison but not this
	// one. The one field readyUnchanged deliberately excludes is
	// `empty.complete` — the count of completed-chain processes, which a
	// sweep that found anything to sweep always reduces by design (#1125
	// defect 5). See ready-compare.mjs for the full rationale.
	const readyAfter = runCli(["status", "ready", scratchFile, "--json"]);
	if (readyAfter.status !== 0) {
		failVerify("failed to read post-sweep 'status ready --json'.", readyAfter);
	}
	if (!readyUnchanged(readyBefore.stdout, readyAfter.stdout)) {
		console.error(
			"sweep-completed-chains: post-sweep 'status ready' output changed; not applying.",
		);
		console.error(`before: ${readyBefore.stdout}`);
		console.error(`after:  ${readyAfter.stdout}`);
		cleanupScratch();
		process.exit(1);
	}

	const blockedAfter = runCli(["status", "blocked", scratchFile, "--json"]);
	if (blockedAfter.status !== 0) {
		failVerify(
			"failed to read post-sweep 'status blocked --json'.",
			blockedAfter,
		);
	}
	if (blockedAfter.stdout !== blockedBefore.stdout) {
		console.error(
			"sweep-completed-chains: post-sweep 'status blocked' output changed; not applying.",
		);
		console.error(`before: ${blockedBefore.stdout}`);
		console.error(`after:  ${blockedAfter.stdout}`);
		cleanupScratch();
		process.exit(1);
	}

	// --- Step 7: apply, only with --write ---

	if (write) {
		writeFileSync(file, deleteResult.stdout, "utf-8");
		console.log(
			`sweep-completed-chains: swept ${deleteIds.length} id(s): ${deleteIds.join(", ")}`,
		);
	} else {
		console.log(
			`sweep-completed-chains: would sweep ${deleteIds.length} id(s) (dry run, pass --write to apply):`,
		);
		console.log(deleteIds.join(", "));
	}
} finally {
	cleanupScratch();
}
