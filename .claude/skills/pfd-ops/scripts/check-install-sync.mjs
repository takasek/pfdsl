#!/usr/bin/env node
// Runtime self-check for the pfd-ops "install/" tree (ADR-0028).
//
// This file ships inside the pfd-ops skill and is copied verbatim (along
// with the rest of the skill tree, including its sibling scripts) into the
// pfdsl plugin (plugin/pfdsl/skills/pfd-ops/scripts/check-install-sync.mjs),
// so it must not import anything outside its own skill tree — Node stdlib
// and sibling files under this directory only.
//
// Usage: node check-install-sync.mjs [--target <dir>] [--deploy] [--force] [--upstream]

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkUpstreamVersion } from "./plugin-version-check.mjs";

/**
 * Recursively enumerate files under installDir, returning repo-root-relative
 * paths (forward-slash separated, sorted) such as
 * ".github/workflows/flow-on-issue-close.yml".
 * @param {string} installDir
 * @returns {string[]}
 */
export function listInstallFiles(installDir) {
	if (!existsSync(installDir)) return [];
	const results = [];
	function walk(dir, relPrefix) {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, rel);
			} else if (entry.isFile()) {
				results.push(rel);
			}
		}
	}
	walk(installDir, "");
	return results.sort();
}

// Used only for values that must persist across runs (the deploy manifest) —
// a plain byte comparison can't be used there since the canonical file it
// would compare against may no longer exist by the time of a later check.
function sha256(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

// Live A/B comparison (both files exist right now): a direct byte compare
// short-circuits on the first differing byte and needs no crypto overhead,
// unlike hashing both sides just to compare the resulting digests.
function filesEqual(pathA, pathB) {
	return readFileSync(pathA).equals(readFileSync(pathB));
}

// Records which install/ files this tool last deployed to a target, plus
// each file's canonical hash at that time, so a later run can tell "canonical
// dropped this file" (check: report orphaned; deploy: safe to remove) apart
// from "a file that merely happens to live at this path but was never
// deployed by this tool" (nothing to report or touch).
const MANIFEST_RELATIVE_PATH = ".claude/pfd-ops-install-manifest.json";

function readManifest(targetRoot) {
	const manifestPath = join(targetRoot, MANIFEST_RELATIVE_PATH);
	if (!existsSync(manifestPath)) return [];
	try {
		const data = JSON.parse(readFileSync(manifestPath, "utf-8"));
		return Array.isArray(data.files) ? data.files : [];
	} catch {
		return [];
	}
}

function writeManifest(targetRoot, entries) {
	const manifestPath = join(targetRoot, MANIFEST_RELATIVE_PATH);
	mkdirSync(dirname(manifestPath), { recursive: true });
	const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
	writeFileSync(manifestPath, `${JSON.stringify({ files: sorted }, null, "\t")}\n`);
}

/**
 * Compare canonical install/ files against their deployed copies at
 * targetRoot. Returns per-file status ("ok" | "modified" | "missing" |
 * "orphaned") plus an overall `adopted` flag (true iff at least one file is
 * deployed). "orphaned" covers a file this tool previously deployed (per the
 * deploy manifest) whose canonical source no longer exists — otherwise such
 * files would be invisible to every check, since they aren't part of the
 * current install/ listing at all.
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @returns {{ results: Array<{path: string, status: "ok"|"modified"|"missing"|"orphaned"}>, adopted: boolean }}
 */
export function checkInstallSync(skillRoot, targetRoot) {
	const installDir = resolve(skillRoot, "install");
	const files = listInstallFiles(installDir);
	const results = files.map((rel) => {
		const targetPath = join(targetRoot, rel);
		if (!existsSync(targetPath)) {
			return { path: rel, status: "missing" };
		}
		const status = filesEqual(join(installDir, rel), targetPath) ? "ok" : "modified";
		return { path: rel, status };
	});

	const currentSet = new Set(files);
	const orphaned = readManifest(targetRoot)
		.filter((entry) => !currentSet.has(entry.path))
		.filter((entry) => existsSync(join(targetRoot, entry.path)))
		.map((entry) => ({ path: entry.path, status: "orphaned" }));

	const allResults = [...results, ...orphaned];
	const adopted = allResults.some((r) => r.status !== "missing");
	return { results: allResults, adopted };
}

/**
 * Copy canonical install/ files to targetRoot, creating directories as
 * needed. A target file whose hash differs from canonical is treated as a
 * local edit and skipped unless force is true (a local edit would otherwise
 * be silently destroyed). Also removes files this tool previously deployed
 * (per the deploy manifest) whose canonical source has since been dropped
 * from install/ — unless the on-disk copy was locally modified, in which
 * case it's left alone (reported in `orphanSkipped`) unless force is given.
 * Writes/updates the deploy manifest afterward so future runs can detect
 * orphans and locally-edited files consistently.
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @param {{ force?: boolean }} [options]
 * @returns {{ copied: string[], skipped: string[], removed: string[], orphanSkipped: string[] }}
 */
export function deployInstall(skillRoot, targetRoot, { force = false } = {}) {
	const installDir = resolve(skillRoot, "install");
	const files = listInstallFiles(installDir);
	const copied = [];
	const skipped = [];
	for (const rel of files) {
		const canonicalPath = join(installDir, rel);
		const targetPath = join(targetRoot, rel);
		if (existsSync(targetPath) && !force && !filesEqual(canonicalPath, targetPath)) {
			skipped.push(rel);
			continue;
		}
		mkdirSync(dirname(targetPath), { recursive: true });
		copyFileSync(canonicalPath, targetPath);
		copied.push(rel);
	}

	const currentSet = new Set(files);
	const removed = [];
	const orphanSkipped = [];
	const retainedOrphanEntries = [];
	for (const entry of readManifest(targetRoot)) {
		if (currentSet.has(entry.path)) continue;
		const targetPath = join(targetRoot, entry.path);
		if (!existsSync(targetPath)) continue;
		if (!force && sha256(targetPath) !== entry.hash) {
			orphanSkipped.push(entry.path);
			// Keep this entry in the manifest — it's still on disk, still
			// orphaned, and still needs a future --force deploy (or check) to
			// find it. Dropping it here would make it invisible from now on.
			retainedOrphanEntries.push(entry);
			continue;
		}
		rmSync(targetPath, { force: true });
		removed.push(entry.path);
	}

	writeManifest(targetRoot, [
		...files.map((rel) => ({ path: rel, hash: sha256(join(installDir, rel)) })),
		...retainedOrphanEntries,
	]);

	return { copied, skipped, removed, orphanSkipped };
}

// --- CLI ---

export function parseArgs(argv) {
	const args = { target: process.cwd(), deploy: false, force: false, upstream: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--target") {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new Error("--target requires a path argument");
			}
			args.target = value;
			i++;
		} else if (arg === "--deploy") {
			args.deploy = true;
		} else if (arg === "--force") {
			args.force = true;
		} else if (arg === "--upstream") {
			args.upstream = true;
		}
	}
	return args;
}

function printGroup(title, items) {
	if (items.length === 0) return;
	console.log(title);
	for (const item of items) console.log(`  ${item}`);
}

async function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (e) {
		console.error(e instanceof Error ? e.message : String(e));
		process.exit(2);
	}
	const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const targetRoot = resolve(args.target);

	let exitCode = 0;

	if (args.deploy) {
		const { copied, skipped, removed, orphanSkipped } = deployInstall(skillRoot, targetRoot, { force: args.force });
		printGroup("Copied:", copied);
		printGroup("Skipped (locally modified; re-run with --force to overwrite):", skipped);
		printGroup("Removed (no longer part of canonical install/):", removed);
		printGroup("Orphaned but locally modified; re-run with --force to remove:", orphanSkipped);
		if (skipped.length > 0 || orphanSkipped.length > 0) exitCode = 1;
		if (copied.length === 0 && skipped.length === 0 && removed.length === 0 && orphanSkipped.length === 0) {
			console.log("Nothing to deploy: install/ is empty.");
		}
	} else {
		const { results, adopted } = checkInstallSync(skillRoot, targetRoot);
		if (!adopted) {
			console.log(
				"The GitHub Issues backend (L3) is not adopted in this repo — no pfd-ops install/ files are deployed.\n" +
					"To adopt it, run: node check-install-sync.mjs --deploy",
			);
		} else {
			const issues = results.filter((r) => r.status !== "ok");
			if (issues.length === 0) {
				console.log("pfd-ops install/ files are in sync with the deployed copies.");
			} else {
				console.log("pfd-ops install/ files are out of sync:");
				for (const r of issues) console.log(`  ${r.status}: ${r.path}`);
				console.log("Run with --deploy to refresh (add --force to overwrite locally edited files).");
				exitCode = 1;
			}
		}
	}

	if (args.upstream) {
		const warning = await checkUpstreamVersion(skillRoot);
		if (warning) console.log(warning);
	}

	process.exit(exitCode);
}

// realpathSync (not resolve) matters here: on macOS, import.meta.url reflects
// the ESM loader's realpath-resolved location (e.g. /tmp -> /private/tmp), so
// a plain resolve() of argv[1] still mismatches when the invocation path
// crosses a symlink.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	main();
}
