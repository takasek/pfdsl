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
//        [--overwrite-local-edits] [--delete-edited-orphans] [--upstream]

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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";
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

/**
 * Pair each orphaned path with the missing canonical path that most likely
 * superseded it. Without this, an upstream rename shows up as an unrelated
 * "missing" plus "orphaned" pair, and a local edit living on the old path is
 * left behind with nothing pointing at the new one (#603).
 *
 * The signals are tried strongest first, and each one is exact — no similarity
 * threshold to tune, so the same inputs always produce the same pairing.
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
		const orphanBase = basename(entry.path);
		const signals = [
			["same canonical hash", (rel) => canonicalHashes.get(rel) === entry.hash],
			["same basename", (rel) => basename(rel) === orphanBase],
			["same basename suffix", (rel) => sharesSeparatedSuffix(basename(rel), orphanBase)],
		];
		for (const [reason, matches] of signals) {
			const to = missing.find(matches);
			if (to !== undefined) {
				candidates.push({ from: entry.path, to, reason });
				break;
			}
		}
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
 * local edit and skipped unless overwriteLocalEdits is true (a local edit would
 * otherwise be silently destroyed). Also removes files this tool previously
 * deployed (per the deploy manifest) whose canonical source has since been
 * dropped from install/ — unless the on-disk copy was locally modified, in
 * which case it's left alone (reported in `orphanSkipped`) unless
 * deleteEditedOrphans is given.
 *
 * Neither override decides whether a file is copied or an orphan is removed —
 * both of those happen on their own. What the overrides decide is whether a
 * local edit standing in the way is discarded, on a surviving path and on a
 * vanishing one respectively. Keeping them separate matters because a single
 * flag covering both discards edits the caller only meant to keep (#603).
 *
 * Writes/updates the deploy manifest afterward so future runs can detect
 * orphans and locally-edited files consistently.
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @param {{ overwriteLocalEdits?: boolean, deleteEditedOrphans?: boolean }} [options]
 * @returns {{ copied: string[], skipped: string[], removed: string[], orphanSkipped: string[] }}
 */
export function deployInstall(
	skillRoot,
	targetRoot,
	{ overwriteLocalEdits = false, deleteEditedOrphans = false } = {},
) {
	const installDir = resolve(skillRoot, "install");
	const files = listInstallFiles(installDir);
	const copied = [];
	const skipped = [];
	for (const rel of files) {
		const canonicalPath = join(installDir, rel);
		const targetPath = join(targetRoot, rel);
		if (existsSync(targetPath) && !overwriteLocalEdits && !filesEqual(canonicalPath, targetPath)) {
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
		if (!deleteEditedOrphans && sha256(targetPath) !== entry.hash) {
			orphanSkipped.push(entry.path);
			// Keep this entry in the manifest — it's still on disk, still
			// orphaned, and still needs a future --delete-edited-orphans deploy
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
	// The migration hint has to be raised before the strict parse, which would
	// otherwise reject --force as a plain unknown option and lose the pointer to
	// the two flags that replaced it (#603). The inline form is matched too:
	// the strict parse rejects it either way, but only this message says what
	// to pass instead.
	if (argv.some((arg) => arg === "--force" || arg.startsWith("--force="))) {
		throw new Error(
			"--force was split into --overwrite-local-edits and --delete-edited-orphans; pass the one you mean",
		);
	}
	// strict mode is the whole point of delegating here: a hand-written argv
	// loop drops anything it doesn't recognize, so a typo'd or --flag=value
	// form of an irreversible option ran a deploy that overwrote and deleted
	// nothing while the caller believed it had (#631). Node rejects unknown
	// options, inline values for booleans, a missing or dash-leading --target
	// value, and stray positionals, none of which this file has to encode.
	const { values } = parseNodeArgs({
		args: argv,
		strict: true,
		allowPositionals: false,
		options: {
			target: { type: "string", default: process.cwd() },
			deploy: { type: "boolean", default: false },
			"overwrite-local-edits": { type: "boolean", default: false },
			"delete-edited-orphans": { type: "boolean", default: false },
			upstream: { type: "boolean", default: false },
		},
	});
	return {
		target: values.target,
		deploy: values.deploy,
		overwriteLocalEdits: values["overwrite-local-edits"],
		deleteEditedOrphans: values["delete-edited-orphans"],
		upstream: values.upstream,
	};
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
		// Printed before the deploy runs, not after it. With
		// --delete-edited-orphans the old path is about to be deleted, and an
		// instruction to carry its local edit over to the new path is worth
		// nothing once the file it points at is gone (#603).
		printRenameCandidates(renameCandidates);
		const { copied, skipped, removed, orphanSkipped } = deployInstall(skillRoot, targetRoot, {
			overwriteLocalEdits: args.overwriteLocalEdits,
			deleteEditedOrphans: args.deleteEditedOrphans,
		});
		// A bare path under "Copied:" reads as "your file moved here", so the
		// destination of a detected rename says outright that it holds canonical
		// content and the old path's edit is not in it — the thing #603 could
		// not tell from the output.
		const renameSources = new Map(renameCandidates.map((c) => [c.to, c.from]));
		printGroup(
			"Copied:",
			copied.map((rel) =>
				renameSources.has(rel)
					? `${rel}  (canonical content only — the edit at ${renameSources.get(rel)} is not in it)`
					: rel,
			),
		);
		printGroup("Skipped (locally modified; re-run with --overwrite-local-edits to overwrite):", skipped);
		printGroup("Removed (no longer part of canonical install/):", removed);
		printGroup(
			"Orphaned but locally modified; re-run with --delete-edited-orphans to remove:",
			orphanSkipped,
		);
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
					"Run with --deploy to refresh. Files that carry no local edit are copied, and orphans that carry none are removed, without any further flag — add --overwrite-local-edits or --delete-edited-orphans only to discard the edits standing in the way.",
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
