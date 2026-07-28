#!/usr/bin/env node
// Runtime self-check for the pfd-ops "install/" tree (ADR-0028).
//
// This file ships inside the pfd-ops skill and is copied verbatim (along
// with the rest of the skill tree, including its sibling scripts) into the
// pfdsl plugin (plugin/pfdsl/skills/pfd-ops/scripts/check-install-sync.mjs),
// so it must not import anything outside its own skill tree — Node stdlib
// and sibling files under this directory only.
//
// Usage: node check-install-sync.mjs [--target <dir>] [--deploy]
//        [--force-overwrite] [--force-remove-orphans] [--upstream]

import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
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
			} else if (entry.isFile() || entry.isSymbolicLink()) {
				// Dirent.isFile()/isDirectory() don't follow symlinks, so a
				// symlinked file would otherwise be silently invisible here —
				// treated as a leaf file (deployInstall's copyFileSync follows
				// the link and copies its target's content, same as any file).
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

function isValidManifestEntry(entry) {
	return (
		entry !== null &&
		typeof entry === "object" &&
		typeof entry.path === "string" &&
		typeof entry.hash === "string"
	);
}

// Malformed entries (hand-edited file, merge conflict, a future schema
// change reading an old manifest) are dropped rather than crashing every
// caller downstream — an entry this tool can't make sense of is exactly
// equivalent to it never having been recorded.
function readManifest(targetRoot) {
	const manifestPath = join(targetRoot, MANIFEST_RELATIVE_PATH);
	if (!existsSync(manifestPath)) return [];
	try {
		const data = JSON.parse(readFileSync(manifestPath, "utf-8"));
		return Array.isArray(data.files) ? data.files.filter(isValidManifestEntry) : [];
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

function basenameOf(rel) {
	const slash = rel.lastIndexOf("/");
	return slash === -1 ? rel : rel.slice(slash + 1);
}

// A rename that only prefixes the basename (flow-on-issue-close.yml ->
// pfdsl-flow-on-issue-close.yml) still has to be recognizable. Requiring the
// added part to end at a separator is what keeps this from pairing files that
// merely share a word ending (exec.mjs / ghexec.mjs).
const BASENAME_SEPARATORS = new Set(["-", "_", "."]);

function sharesSeparatedSuffix(a, b) {
	const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
	if (!longer.endsWith(shorter)) return false;
	return BASENAME_SEPARATORS.has(longer[longer.length - shorter.length - 1]);
}

// Strongest first. Each signal is exact — no similarity threshold to tune, so
// the same inputs always produce the same pairing.
const RENAME_REASONS = ["same canonical hash", "same basename", "same basename suffix"];

/**
 * Pair each orphaned path with the missing canonical path that most likely
 * superseded it. Without this, an upstream rename shows up as an unrelated
 * "missing" plus "orphaned" pair, and a local edit living on the old path is
 * left behind with nothing pointing at the new one (#603).
 * @param {string} installDir
 * @param {string[]} missing repo-relative canonical paths absent from the target
 * @param {Array<{path: string, hash: string}>} orphanEntries manifest entries whose canonical source is gone
 * @returns {Array<{from: string, to: string, reason: string}>}
 */
function detectRenameCandidates(installDir, missing, orphanEntries) {
	if (missing.length === 0 || orphanEntries.length === 0) return [];
	const canonicalHashes = new Map(missing.map((rel) => [rel, sha256(join(installDir, rel))]));

	const candidates = [];
	for (const entry of orphanEntries) {
		const orphanBase = basenameOf(entry.path);
		let best = null;
		for (const rel of missing) {
			const base = basenameOf(rel);
			let reason = null;
			if (canonicalHashes.get(rel) === entry.hash) reason = "same canonical hash";
			else if (base === orphanBase) reason = "same basename";
			else if (sharesSeparatedSuffix(base, orphanBase)) reason = "same basename suffix";
			if (reason === null) continue;
			if (best === null || RENAME_REASONS.indexOf(reason) < RENAME_REASONS.indexOf(best.reason)) {
				best = { from: entry.path, to: rel, reason };
			}
		}
		if (best !== null) candidates.push(best);
	}
	return candidates;
}

/**
 * Compare canonical install/ files against their deployed copies at
 * targetRoot. Returns per-file status ("ok" | "modified" | "missing" |
 * "orphaned"), an overall `adopted` flag (true iff at least one file is
 * deployed), and `renameCandidates` pairing orphans with their likely
 * successors. "orphaned" covers a file this tool previously deployed (per the
 * deploy manifest) whose canonical source no longer exists — otherwise such
 * files would be invisible to every check, since they aren't part of the
 * current install/ listing at all.
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @returns {{ results: Array<{path: string, status: "ok"|"modified"|"missing"|"orphaned"}>, adopted: boolean, renameCandidates: Array<{from: string, to: string, reason: string}> }}
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
	const orphanEntries = readManifest(targetRoot)
		.filter((entry) => !currentSet.has(entry.path))
		.filter((entry) => existsSync(join(targetRoot, entry.path)));
	const orphaned = orphanEntries.map((entry) => ({ path: entry.path, status: "orphaned" }));

	const allResults = [...results, ...orphaned];
	const adopted = allResults.some((r) => r.status !== "missing");
	const renameCandidates = detectRenameCandidates(
		installDir,
		results.filter((r) => r.status === "missing").map((r) => r.path),
		orphanEntries,
	);
	return { results: allResults, adopted, renameCandidates };
}

/**
 * Copy canonical install/ files to targetRoot, creating directories as
 * needed. A target file whose hash differs from canonical is treated as a
 * local edit and skipped unless forceOverwrite is true (a local edit would
 * otherwise be silently destroyed). Also removes files this tool previously
 * deployed (per the deploy manifest) whose canonical source has since been
 * dropped from install/ — unless the on-disk copy was locally modified, in
 * which case it's left alone (reported in `orphanSkipped`) unless
 * forceRemoveOrphans is given.
 *
 * The two overrides are deliberately separate: sweeping a renamed old path
 * and discarding a customization on a surviving path are different intents,
 * and a single flag covering both silently reverts customizations the caller
 * only meant to keep (#603).
 *
 * Writes/updates the deploy manifest afterward so future runs can detect
 * orphans and locally-edited files consistently.
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @param {{ forceOverwrite?: boolean, forceRemoveOrphans?: boolean }} [options]
 * @returns {{ copied: string[], skipped: string[], removed: string[], orphanSkipped: string[] }}
 */
export function deployInstall(
	skillRoot,
	targetRoot,
	{ forceOverwrite = false, forceRemoveOrphans = false } = {},
) {
	const installDir = resolve(skillRoot, "install");
	const files = listInstallFiles(installDir);
	const copied = [];
	const skipped = [];
	for (const rel of files) {
		const canonicalPath = join(installDir, rel);
		const targetPath = join(targetRoot, rel);
		if (existsSync(targetPath) && !forceOverwrite && !filesEqual(canonicalPath, targetPath)) {
			skipped.push(rel);
			continue;
		}
		mkdirSync(dirname(targetPath), { recursive: true });
		copyFileSync(canonicalPath, targetPath);
		// copyFileSync's mode handling is platform-dependent (observed: preserved
		// on macOS/APFS via clonefile, dropped to the umask default on Linux) —
		// chmod explicitly so canonical and deployed stay bit-for-bit identical
		// regardless of OS (#421).
		chmodSync(targetPath, statSync(canonicalPath).mode);
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
		if (!forceRemoveOrphans && sha256(targetPath) !== entry.hash) {
			orphanSkipped.push(entry.path);
			// Keep this entry in the manifest — it's still on disk, still
			// orphaned, and still needs a future --force-remove-orphans deploy
			// (or check) to find it. Dropping it here would make it invisible
			// from now on.
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
	const args = {
		target: process.cwd(),
		deploy: false,
		forceOverwrite: false,
		forceRemoveOrphans: false,
		upstream: false,
	};
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
			// Rejected rather than ignored: an unrecognized flag is silently
			// dropped here, which would run an unforced deploy while the caller
			// believes they forced one (#603).
			throw new Error(
				"--force was split into --force-overwrite and --force-remove-orphans; pass the one you mean",
			);
		} else if (arg === "--force-overwrite") {
			args.forceOverwrite = true;
		} else if (arg === "--force-remove-orphans") {
			args.forceRemoveOrphans = true;
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

function printRenameCandidates(candidates) {
	printGroup(
		"Possible renames (carry any local edit from the old path over to the new one before trusting the deployed copy):",
		candidates.map((c) => `${c.from} -> ${c.to}  (${c.reason})`),
	);
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
		// Read the pre-deploy state: deployInstall rewrites the manifest and may
		// delete the very orphans a rename is inferred from.
		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		const { copied, skipped, removed, orphanSkipped } = deployInstall(skillRoot, targetRoot, {
			forceOverwrite: args.forceOverwrite,
			forceRemoveOrphans: args.forceRemoveOrphans,
		});
		printGroup("Copied:", copied);
		printGroup("Skipped (locally modified; re-run with --force-overwrite to overwrite):", skipped);
		printGroup("Removed (no longer part of canonical install/):", removed);
		printGroup(
			"Orphaned but locally modified; re-run with --force-remove-orphans to remove:",
			orphanSkipped,
		);
		printRenameCandidates(renameCandidates);
		if (skipped.length > 0 || orphanSkipped.length > 0) exitCode = 1;
		if (copied.length === 0 && skipped.length === 0 && removed.length === 0 && orphanSkipped.length === 0) {
			console.log("Nothing to deploy: install/ is empty.");
		}
	} else {
		const { results, adopted, renameCandidates } = checkInstallSync(skillRoot, targetRoot);
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
				printRenameCandidates(renameCandidates);
				console.log(
					"Run with --deploy to refresh (add --force-overwrite to overwrite locally edited files, --force-remove-orphans to delete orphans).",
				);
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
