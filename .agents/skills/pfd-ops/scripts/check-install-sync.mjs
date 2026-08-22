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
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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

// What tells an upstream repo (the one that *generates* this skill's install/
// tree) apart from a repo that merely adopted it. install/ is a generated
// mirror there, so canonical runs the other way: deploying into it overwrites
// the generator's own sources with an older snapshot (#971).
//
// The set is required to be complete, never merely non-empty. A sparse
// checkout, a half-finished vendoring, or an old branch shows one or two of
// these, and reading a missing marker as proof of "not upstream" is exactly
// the misclassification that lets a deploy regress the sources.
//
// Each marker matches on content, not just on its path. "scripts/gen-install.mjs"
// is an ordinary name that an unrelated adopting repo can own by coincidence,
// and a path-only match would call that repo ambiguous — costing it the ability
// to adopt at all, which is the primary flow this tool exists for.
export const UPSTREAM_MARKERS = [
	{ path: "scripts/gen-install.mjs", mustContain: ".claude/skills/pfd-ops/install" },
	{ path: "scripts/lib/install-templates.mjs", mustContain: ".claude/skills/pfd-ops/install" },
	{ path: "plugin/pfdsl/.claude-plugin/plugin.json", mustContain: '"name": "pfdsl"' },
];

const REPO_LOCAL_SKILL_RELATIVE_PATH = ".claude/skills/pfd-ops";

// realpath before comparing, and compare by path segments rather than string
// prefix: "/x/repo-a".startsWith("/x/repo") is true, and a symlinked or
// ..-bearing path resolves elsewhere than it reads. Same reason the entrypoint
// check at the bottom of this file realpaths before comparing.
function realpathOrSelf(path) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function fileContains(path, needle) {
	try {
		return readFileSync(path, "utf-8").includes(needle);
	} catch {
		// Absent, unreadable, or a directory: all mean "this marker is not here".
		return false;
	}
}

function contains(ancestor, descendant) {
	const rel = relative(realpathOrSelf(ancestor), realpathOrSelf(descendant));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Markers live at the repo root, but --target defaults to cwd and may be any
// directory inside the repo. Without this ascent, running from a subdirectory
// sees no markers at all and the upstream repo classifies as an adopter.
function findRepoRoot(targetRoot) {
	let dir = resolve(targetRoot);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return resolve(targetRoot);
		dir = parent;
	}
}

/**
 * Decide which side of this comparison owns canonical, so that all three
 * places that speak about --deploy (the adoption hint, the refresh hint, and
 * the deploy itself) answer from one judgement rather than three.
 *
 * "upstream": every marker matches — canonical is the target's own sources.
 * "ambiguous": some markers match but not all, or the target carries a
 * repo-local pfd-ops install/ that this script is not (note that the second
 * arm needs no marker at all, so zero markers does not imply "adopter").
 * "adopter": neither — the ordinary case, where canonical is the install/ tree
 * shipped alongside this script. Only "adopter" may be deployed into.
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @returns {{ kind: "upstream"|"ambiguous"|"adopter", repoRoot: string, repoLocalRun: boolean, presentMarkers: string[], missingMarkers: string[], competingCanonical: string|null }}
 */
export function classifyTarget(skillRoot, targetRoot) {
	const repoRoot = findRepoRoot(targetRoot);
	const repoLocalRun = contains(repoRoot, skillRoot);
	const present = UPSTREAM_MARKERS.filter((marker) =>
		fileContains(join(repoRoot, ...marker.path.split("/")), marker.mustContain),
	);
	const presentMarkers = present.map((marker) => marker.path);
	const missingMarkers = UPSTREAM_MARKERS.filter((marker) => !present.includes(marker)).map(
		(marker) => marker.path,
	);

	// A repo-local skill tree only competes when the running script is not it:
	// a repo-local run over its own vendored copy is one entity seen twice.
	const repoLocalSkill = join(repoRoot, ...REPO_LOCAL_SKILL_RELATIVE_PATH.split("/"));
	const competingCanonical =
		!repoLocalRun && existsSync(join(repoLocalSkill, "install")) ? repoLocalSkill : null;

	const kind =
		missingMarkers.length === 0
			? "upstream"
			: presentMarkers.length > 0 || competingCanonical !== null
				? "ambiguous"
				: "adopter";
	return { kind, repoRoot, repoLocalRun, presentMarkers, missingMarkers, competingCanonical };
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

/**
 * Report a target this tool must not deploy into, and say what the reader can
 * do instead. The differing files are still listed — they are real information
 * about which side is older — but no --deploy appears anywhere in the output,
 * including when one was explicitly asked for.
 * @param {ReturnType<typeof classifyTarget>} role
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @param {boolean} deployRequested
 * @returns {boolean} whether any deployed file differs from this copy's install/
 */
function reportNonDeployableTarget(role, skillRoot, targetRoot, deployRequested) {
	if (role.kind === "upstream") {
		console.log(
			`This target is the upstream repo that generates pfd-ops' install/ tree (${role.repoRoot}).\n` +
				"There, install/ is a generated mirror and the repo's own sources are canonical, so this copy must not write into it.",
		);
	} else {
		console.log(
			`Canonical is ambiguous for this target (${role.repoRoot}) — two entities claim it and nothing here can settle which:\n` +
				`  this copy's install/: ${resolve(skillRoot, "install")}\n` +
				`  in the target:        ${role.competingCanonical ?? "partial upstream markers"}\n` +
				`  upstream markers present: ${role.presentMarkers.join(", ") || "(none)"}\n` +
				`  upstream markers missing: ${role.missingMarkers.join(", ") || "(none)"}`,
		);
	}

	const { results } = checkInstallSync(skillRoot, targetRoot);
	const issues = results.filter((r) => r.status !== "ok");
	if (issues.length === 0) {
		console.log("pfd-ops install/ files are in sync with the deployed copies.");
	} else {
		console.log("Files that differ from this copy's install/:");
		for (const r of issues) console.log(`  ${r.status}: ${r.path}`);
	}
	// A repo-local run in the upstream repo is reading its own generated mirror,
	// so any difference above is gen-install drift and the fix is to regenerate.
	// Naming the plugin there would send the reader to a copy that is not
	// involved (and, in the drift direction that matters, is the stale one).
	// Only when something actually differs: a remedy printed for a difference
	// that is not there reads as an instruction to go change something.
	const remedy =
		issues.length === 0
			? ""
			: role.kind === "upstream" && role.repoLocalRun
				? " install/ is generated from the repo's own sources — reconcile the difference in those sources, then run 'node scripts/gen-install.mjs' to regenerate the mirror (regenerating first discards any edit made directly to install/)."
				: " If this copy is the older snapshot, update the plugin or re-run the check from the repo-local copy instead.";
	console.log(deployRequested ? `Refusing to deploy.${remedy}` : `Nothing to deploy from here.${remedy}`);
	return issues.length > 0;
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

	// Decided once, then answered from in all three places that speak about
	// --deploy. Asking separately per branch is how they drift apart, and the
	// two that only print text would keep pointing at the one that writes.
	const role = classifyTarget(skillRoot, targetRoot);
	const deployable = role.kind === "adopter";
	if (!deployable) {
		const drifted = reportNonDeployableTarget(role, skillRoot, targetRoot, args.deploy);
		// 3, not the 2 a malformed argv exits with: the argv was well-formed and
		// this refusal is about the target, so a caller reading only the code can
		// still tell "you typed it wrong" from "I will not write there".
		exitCode = args.deploy ? 3 : drifted ? 1 : 0;
	} else if (args.deploy) {
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
		// The manifest is written on every deploy but is not one of the copied
		// files, so it would otherwise turn up in `git status` as an unexplained
		// new file (a distribution-review probe hit exactly that).
		console.log(`Wrote deploy manifest: ${MANIFEST_RELATIVE_PATH}`);
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
					// The full path, not the bare filename: the reader is standing
					// in their repo root while this script lives in a plugin
					// cache outside it, so a bare name — or a relative one —
					// makes them reconstruct the path the caller just used.
					// --target is spelled out for the same reason it is resolved
					// rather than echoed verbatim: it defaults to the cwd, so a
					// reader who copies this line from a different directory
					// deploys into that other directory instead of the repo the
					// line was printed about.
					`To adopt it, run: node ${fileURLToPath(import.meta.url)} --target ${targetRoot} --deploy`,
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
// crosses a symlink. This is the same comparison scripts/lib/cli-entrypoint.mjs
// makes, spelled inline rather than imported: the file is distributed with the
// pfd-ops skill and runs in adopting repos, which have no scripts/lib/ (#707).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	main();
}
