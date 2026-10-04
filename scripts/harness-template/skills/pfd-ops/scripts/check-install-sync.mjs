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
//        | --record-migration (exclusive with --deploy, --overwrite-local-edits
//        and --delete-edited-orphans)

import { createHash } from "node:crypto";
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
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";
import {
	checkUpstreamVersion,
	readPluginIdentity,
} from "./plugin-version-check.mjs";

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
export function readManifest(targetRoot) {
	const manifestPath = join(targetRoot, MANIFEST_RELATIVE_PATH);
	if (!existsSync(manifestPath)) return [];
	try {
		const data = JSON.parse(readFileSync(manifestPath, "utf-8"));
		return Array.isArray(data.files)
			? data.files.filter(isValidManifestEntry)
			: [];
	} catch {
		return [];
	}
}

function writeManifest(targetRoot, entries) {
	const manifestPath = join(targetRoot, MANIFEST_RELATIVE_PATH);
	mkdirSync(dirname(manifestPath), { recursive: true });
	const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
	writeFileSync(
		manifestPath,
		`${JSON.stringify({ files: sorted }, null, "\t")}\n`,
	);
}

// A rename that only prefixes the basename (sweep-completed-chains.yml ->
// pfdsl-sweep-completed-chains.yml) still has to be recognizable. Requiring the
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
	const canonicalHashes = new Map(
		missing.map((rel) => [rel, sha256(join(installDir, rel))]),
	);

	const candidates = [];
	for (const entry of orphanEntries) {
		const orphanBase = basename(entry.path);
		const signals = [
			["same canonical hash", (rel) => canonicalHashes.get(rel) === entry.hash],
			["same basename", (rel) => basename(rel) === orphanBase],
			[
				"same basename suffix",
				(rel) => sharesSeparatedSuffix(basename(rel), orphanBase),
			],
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
	{
		path: "scripts/gen-install.mjs",
		mustContain: ".claude/skills/pfd-ops/install",
	},
	{
		path: "scripts/lib/install-templates.mjs",
		mustContain: ".claude/skills/pfd-ops/install",
	},
	{
		path: "plugin/pfdsl/.claude-plugin/plugin.json",
		mustContain: '"name": "pfdsl"',
	},
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
	const missingMarkers = UPSTREAM_MARKERS.filter(
		(marker) => !present.includes(marker),
	).map((marker) => marker.path);

	// A repo-local skill tree only competes when the running script is not it:
	// a repo-local run over its own vendored copy is one entity seen twice.
	const repoLocalSkill = join(
		repoRoot,
		...REPO_LOCAL_SKILL_RELATIVE_PATH.split("/"),
	);
	const competingCanonical =
		!repoLocalRun && existsSync(join(repoLocalSkill, "install"))
			? repoLocalSkill
			: null;

	const kind =
		missingMarkers.length === 0
			? "upstream"
			: presentMarkers.length > 0 || competingCanonical !== null
				? "ambiguous"
				: "adopter";
	return {
		kind,
		repoRoot,
		repoLocalRun,
		presentMarkers,
		missingMarkers,
		competingCanonical,
	};
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
		const status = filesEqual(join(installDir, rel), targetPath)
			? "ok"
			: "modified";
		return { path: rel, status };
	});

	const currentSet = new Set(files);
	const orphanEntries = readManifest(targetRoot)
		.filter((entry) => !currentSet.has(entry.path))
		.filter((entry) => existsSync(join(targetRoot, entry.path)));
	const orphaned = orphanEntries.map((entry) => ({
		path: entry.path,
		status: "orphaned",
	}));

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
 * needed. A target differing from both the last deployed hash and the new
 * canonical is preserved unless overwriteLocalEdits is true. Untracked
 * conflicting files are preserved too. Also removes files this tool previously
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
	const previousEntries = readManifest(targetRoot);
	const previousByPath = new Map(
		previousEntries.map((entry) => [entry.path, entry]),
	);
	const deployedEntries = [];
	for (const rel of files) {
		const canonicalPath = join(installDir, rel);
		const targetPath = join(targetRoot, rel);
		const previous = previousByPath.get(rel);
		if (
			existsSync(targetPath) &&
			!overwriteLocalEdits &&
			!filesEqual(canonicalPath, targetPath) &&
			(!previous || sha256(targetPath) !== previous.hash)
		) {
			skipped.push(rel);
			// A skipped copy never establishes a new deployment baseline. An
			// untracked conflicting file must remain untracked as well.
			if (previous) deployedEntries.push(previous);
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
		deployedEntries.push({ path: rel, hash: sha256(targetPath) });
	}

	const currentSet = new Set(files);
	const removed = [];
	const orphanSkipped = [];
	const retainedOrphanEntries = [];
	for (const entry of previousEntries) {
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

	writeManifest(targetRoot, [...deployedEntries, ...retainedOrphanEntries]);

	return { copied, skipped, removed, orphanSkipped };
}

// --- Applied migration state (#1319, ADR-0043) ---
//
// An adopter records in .pfdsl/config.json the plugin release it has finished
// migrating to. Everything here only reads that record; the one writer is the
// explicit --record-migration, run by whoever applied the migration.

const CONFIG_RELATIVE_PATH = ".pfdsl/config.json";
export const MIGRATION_GUIDE_URL =
	"https://github.com/takasek/pfdsl/blob/main/docs/migration-guide.md";

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Read .pfdsl/config.json. Absent is a normal state (null); a file that is
 * there but cannot be understood throws, naming the file — a broken
 * declaration must not be read as "nothing declared", the same rule the sweep
 * workflow applies to this file (ADR-0042).
 * @param {string} targetRoot
 * @returns {{ text: string, config: Record<string, unknown> } | null}
 */
function readConfigFile(targetRoot) {
	let text;
	try {
		text = readFileSync(
			join(targetRoot, ...CONFIG_RELATIVE_PATH.split("/")),
			"utf-8",
		);
	} catch (e) {
		if (e.code === "ENOENT") return null;
		throw new Error(`${CONFIG_RELATIVE_PATH} cannot be read: ${e.message}`);
	}
	let config;
	try {
		config = JSON.parse(text);
	} catch (e) {
		throw new Error(`${CONFIG_RELATIVE_PATH} is not valid JSON: ${e.message}`);
	}
	if (!isPlainObject(config)) {
		throw new Error(
			`${CONFIG_RELATIVE_PATH} must contain a JSON object at the top level`,
		);
	}
	return { text, config };
}

/**
 * What is wrong with an appliedMigration value, or null when it is well formed.
 * @param {unknown} value
 * @returns {string | null}
 */
function recordedMigrationProblem(value) {
	if (!isPlainObject(value)) return "that is not an object";
	if (
		typeof value.pluginVersion !== "string" ||
		value.pluginVersion.length === 0
	) {
		return "whose pluginVersion is not a non-empty string";
	}
	if (value.bundleHash !== undefined && typeof value.bundleHash !== "string") {
		return "whose bundleHash is not a string";
	}
	return null;
}

/**
 * @param {Record<string, unknown>} config
 * @param {{ ignoreMalformed?: boolean }} [options] ignoreMalformed reads a record
 *   of the wrong shape as absent instead of throwing; only the writer asks for it,
 *   so that a record the checks refuse can still be replaced
 * @returns {{ pluginVersion: string, bundleHash: string | null } | null} null when the key is absent
 */
function readRecordedMigration(config, { ignoreMalformed = false } = {}) {
	if (!("appliedMigration" in config)) return null;
	const value = config.appliedMigration;
	const problem = recordedMigrationProblem(value);
	if (problem !== null) {
		if (ignoreMalformed) return null;
		throw new Error(
			`${CONFIG_RELATIVE_PATH} has an appliedMigration ${problem}`,
		);
	}
	return {
		pluginVersion: value.pluginVersion,
		bundleHash: value.bundleHash ?? null,
	};
}

function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	return match === null ? null : match.slice(1).map(Number);
}

// Numeric per component: as strings, "0.10.0" would sort before "0.9.0".
function compareParsedVersions(a, b) {
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
	}
	return 0;
}

/**
 * Compare the running plugin with the migration state the adopter recorded.
 * Throws when .pfdsl/config.json or its appliedMigration is malformed, unless
 * ignoreMalformedRecord is set: then an appliedMigration of the wrong shape is
 * read as absent (the file itself must still be a JSON object).
 * @param {string} targetRoot
 * @param {{ version: string, bundleHash: string | null } | null} running null when the version is unknown
 * @param {{ ignoreMalformedRecord?: boolean }} [options]
 * @returns {{ kind: "no-pfdsl" | "absent" }
 *   | { kind: "unknown-running", recorded: { pluginVersion: string, bundleHash: string | null } }
 *   | { kind: "older" | "newer" | "different-content" | "uncomparable" | "in-sync", recorded: { pluginVersion: string, bundleHash: string | null }, running: { version: string, bundleHash: string | null } }}
 */
export function evaluateMigration(
	targetRoot,
	running,
	{ ignoreMalformedRecord = false } = {},
) {
	if (!isDirectory(join(targetRoot, ".pfdsl"))) return { kind: "no-pfdsl" };
	const file = readConfigFile(targetRoot);
	const recorded =
		file === null
			? null
			: readRecordedMigration(file.config, {
					ignoreMalformed: ignoreMalformedRecord,
				});
	if (recorded === null) return { kind: "absent" };
	if (running === null) return { kind: "unknown-running", recorded };

	const runningParts = parseVersion(running.version);
	const recordedParts = parseVersion(recorded.pluginVersion);
	if (runningParts === null || recordedParts === null) {
		return { kind: "uncomparable", recorded, running };
	}
	const order = compareParsedVersions(runningParts, recordedParts);
	if (order < 0) return { kind: "older", recorded, running };
	if (order > 0) return { kind: "newer", recorded, running };
	if (
		running.bundleHash !== null &&
		recorded.bundleHash !== null &&
		running.bundleHash !== recorded.bundleHash
	) {
		return { kind: "different-content", recorded, running };
	}
	return { kind: "in-sync", recorded, running };
}

/**
 * What to tell the reader about a comparison, or null when there is nothing to
 * say (no .pfdsl/, or the running plugin matches the record).
 * @param {ReturnType<typeof evaluateMigration>} outcome
 * @param {string | null} recordCommand the command that records the state, or null when it would be refused because the running plugin's version is unknown
 * @returns {string | null}
 */
export function describeMigration(outcome, recordCommand) {
	switch (outcome.kind) {
		case "absent":
			return (
				`This repo has no appliedMigration in ${CONFIG_RELATIVE_PATH}, so it predates migration-state tracking and the plugin cannot tell which migrations were applied.\n` +
				`To catch up, read "Choosing the update range" in the migration guide (${MIGRATION_GUIDE_URL}) and apply the entries for your range. ` +
				(recordCommand === null
					? "After applying them, recording the state needs a run from the installed plugin (Claude Code or Codex): the version of the running pfd-ops is unknown here, so it cannot be recorded from this copy."
					: `After applying them, record the state with: ${recordCommand}`)
			);
		case "unknown-running":
			return `Skipped the migration-state comparison: the running pfd-ops is not inside an installed plugin (no .claude-plugin/plugin.json or .codex-plugin/plugin.json above the skill), so its plugin version is unknown.`;
		case "older":
			return `The running plugin (${outcome.running.version}) is older than the migration state recorded in ${CONFIG_RELATIVE_PATH} (${outcome.recorded.pluginVersion}). Update the plugin. --deploy and --record-migration are refused until then, because an older install/ would roll back files that a newer release placed.`;
		case "newer":
			return (
				`The running plugin (${outcome.running.version}) is newer than the migration state recorded in ${CONFIG_RELATIVE_PATH} (${outcome.recorded.pluginVersion}).\n` +
				`Read the migration guide entries introduced after ${outcome.recorded.pluginVersion} through ${outcome.running.version} ("Choosing the update range": ${MIGRATION_GUIDE_URL}) and apply them. After applying them, record the state with: ${recordCommand}`
			);
		case "different-content":
			return `The running plugin and the migration state recorded in ${CONFIG_RELATIVE_PATH} have the same version (${outcome.running.version}) but different content (bundle hash ${outcome.running.bundleHash} against recorded ${outcome.recorded.bundleHash}). Which one is newer cannot be determined, as with a development build and a released one that share a version number. Nothing is refused.`;
		case "uncomparable":
			return `The running plugin version (${outcome.running.version}) and the one recorded in ${CONFIG_RELATIVE_PATH} (${outcome.recorded.pluginVersion}) cannot be compared: both must be x.y.z. Nothing is refused.`;
		default:
			return null;
	}
}

/**
 * Write the running plugin's identity into appliedMigration, keeping every
 * other key and, as far as is reasonable, the file's own formatting (indent
 * width or tabs, trailing newline; tab-indented with a newline for a new
 * file, like this repo's own config). The caller has already established that
 * the target is an adopter; every other reason this cannot be recorded throws
 * before anything is written. An existing appliedMigration of the wrong shape
 * does not stop it: the record is being replaced, and the older-plugin refusal
 * cannot be evaluated against a version that cannot be read, so the write is
 * allowed. The file itself must still be a JSON object.
 * @param {string} targetRoot
 * @param {{ version: string, bundleHash: string | null } | null} running
 * @returns {{ pluginVersion: string, bundleHash?: string }} the entry written
 */
export function recordMigration(targetRoot, running) {
	if (!isDirectory(join(targetRoot, ".pfdsl"))) {
		throw new Error(
			`Cannot record the migration state: ${targetRoot} has no .pfdsl/ directory, so it is not a repo that has adopted pfdsl.`,
		);
	}
	if (running === null) {
		throw new Error(
			"Cannot record the migration state: the version of the running plugin is unknown (no .claude-plugin/plugin.json or .codex-plugin/plugin.json above the skill). Run this from the installed plugin, not from a repo-local copy.",
		);
	}
	const file = readConfigFile(targetRoot);
	const recorded =
		file === null
			? null
			: readRecordedMigration(file.config, { ignoreMalformed: true });
	if (recorded !== null) {
		const runningParts = parseVersion(running.version);
		const recordedParts = parseVersion(recorded.pluginVersion);
		if (
			runningParts !== null &&
			recordedParts !== null &&
			compareParsedVersions(runningParts, recordedParts) < 0
		) {
			throw new Error(
				`Cannot record the migration state: the running plugin (${running.version}) is older than the one already recorded in ${CONFIG_RELATIVE_PATH} (${recorded.pluginVersion}). Update the plugin first.`,
			);
		}
	}

	const entry = { pluginVersion: running.version };
	if (running.bundleHash !== null) entry.bundleHash = running.bundleHash;
	// Spreading keeps an existing appliedMigration where it already sits.
	const config = { ...(file?.config ?? {}), appliedMigration: entry };
	const indent =
		file === null ? "\t" : (/^([ \t]+)\S/m.exec(file.text)?.[1] ?? "\t");
	const newline = file === null || file.text.endsWith("\n") ? "\n" : "";
	writeFileSync(
		join(targetRoot, ...CONFIG_RELATIVE_PATH.split("/")),
		`${JSON.stringify(config, null, indent)}${newline}`,
	);
	return entry;
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
			"record-migration": { type: "boolean", default: false },
		},
	});
	// Recording is the last step of a migration, after the deploy and the rest
	// of it have been verified; one invocation cannot be both.
	if (values["record-migration"] && values.deploy) {
		throw new Error(
			"--record-migration cannot be combined with --deploy: record the migration state only after the deploy and the rest of the migration have been verified",
		);
	}
	// Both only change what --deploy does, so beside --record-migration they would
	// be accepted and have no effect, the silent no-op #631 closed for typos.
	for (const flag of ["overwrite-local-edits", "delete-edited-orphans"]) {
		if (values["record-migration"] && values[flag]) {
			throw new Error(
				`--record-migration cannot be combined with --${flag}: it only changes what --deploy does, and recording writes no install/ files`,
			);
		}
	}
	return {
		target: values.target,
		deploy: values.deploy,
		overwriteLocalEdits: values["overwrite-local-edits"],
		deleteEditedOrphans: values["delete-edited-orphans"],
		upstream: values.upstream,
		recordMigration: values["record-migration"],
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
function reportNonDeployableTarget(
	role,
	skillRoot,
	targetRoot,
	deployRequested,
) {
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
	console.log(
		deployRequested
			? `Refusing to deploy.${remedy}`
			: `Nothing to deploy from here.${remedy}`,
	);
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
	const running = readPluginIdentity(resolve(skillRoot, "../.."));
	// A plain check must not end by telling the reader to run the --deploy that
	// the notice above it says will be refused.
	let deployRefused = false;
	if (deployable) {
		// Independent of --upstream and of whether the GitHub Issues backend is
		// adopted: the record concerns the repo's migration, not any one feature.
		// With no running version the command would be refused (exit 3), so none is offered.
		const recordCommand =
			running === null
				? null
				: `node ${fileURLToPath(import.meta.url)} --target ${targetRoot} --record-migration`;
		let outcome;
		try {
			// --record-migration is the repair for a malformed record, so it alone reads past one.
			outcome = evaluateMigration(targetRoot, running, {
				ignoreMalformedRecord: args.recordMigration,
			});
		} catch (e) {
			// 3, as for any refusal about the target: the argv was fine, the
			// declaration in the target is not.
			console.error(e instanceof Error ? e.message : String(e));
			process.exit(3);
		}
		// Before any write: an older install/ would roll back what a newer
		// release placed, and a record from it would claim an older state.
		deployRefused = outcome.kind === "older";
		const refused = deployRefused && (args.deploy || args.recordMigration);
		// Advice to "record the state afterwards" is noise in the run that does it.
		const notice =
			args.recordMigration && !refused
				? null
				: describeMigration(outcome, recordCommand);
		if (notice !== null) console.log(notice);
		if (refused) process.exit(3);
	}
	if (!deployable) {
		if (args.recordMigration) {
			console.error(
				role.kind === "upstream"
					? `Cannot record the migration state: this target is the upstream repo (${role.repoRoot}), which generates the plugin rather than adopting it.`
					: `Cannot record the migration state: canonical is ambiguous for this target (${role.repoRoot}), so it cannot be told whether it is an adopter.`,
			);
			process.exit(3);
		}
		const drifted = reportNonDeployableTarget(
			role,
			skillRoot,
			targetRoot,
			args.deploy,
		);
		// 3, not the 2 a malformed argv exits with: the argv was well-formed and
		// this refusal is about the target, so a caller reading only the code can
		// still tell "you typed it wrong" from "I will not write there".
		exitCode = args.deploy ? 3 : drifted ? 1 : 0;
	} else if (args.recordMigration) {
		try {
			const entry = recordMigration(targetRoot, running);
			console.log(
				`Recorded appliedMigration in ${CONFIG_RELATIVE_PATH}: pluginVersion ${entry.pluginVersion}${entry.bundleHash === undefined ? " (no bundleHash: this plugin has no bundle manifest)" : `, bundleHash ${entry.bundleHash}`}.\n` +
					"Commit it together with the migration changes.",
			);
		} catch (e) {
			console.error(e instanceof Error ? e.message : String(e));
			process.exit(3);
		}
	} else if (args.deploy) {
		// Read the pre-deploy state: deployInstall rewrites the manifest and may
		// delete the very orphans a rename is inferred from.
		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		// Printed before the deploy runs, not after it. With
		// --delete-edited-orphans the old path is about to be deleted, and an
		// instruction to carry its local edit over to the new path is worth
		// nothing once the file it points at is gone (#603).
		printRenameCandidates(renameCandidates);
		const { copied, skipped, removed, orphanSkipped } = deployInstall(
			skillRoot,
			targetRoot,
			{
				overwriteLocalEdits: args.overwriteLocalEdits,
				deleteEditedOrphans: args.deleteEditedOrphans,
			},
		);
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
		console.log(
			`Before running the audit, follow the dependency setup and first-audit instructions in ${join(skillRoot, "references/github-issues-backend.md")}. File deployment alone does not install runtime dependencies.`,
		);
		printGroup(
			"Skipped (locally modified; re-run with --overwrite-local-edits to overwrite):",
			skipped,
		);
		printGroup("Removed (no longer part of canonical install/):", removed);
		printGroup(
			"Orphaned but locally modified; re-run with --delete-edited-orphans to remove:",
			orphanSkipped,
		);
		if (skipped.length > 0 || orphanSkipped.length > 0) exitCode = 1;
		if (
			copied.length === 0 &&
			skipped.length === 0 &&
			removed.length === 0 &&
			orphanSkipped.length === 0
		) {
			console.log("Nothing to deploy: install/ is empty.");
		}
	} else {
		const { results, adopted, renameCandidates } = checkInstallSync(
			skillRoot,
			targetRoot,
		);
		if (!adopted) {
			// The full path, not the bare filename: the reader is standing
			// in their repo root while this script lives in a plugin
			// cache outside it, so a bare name — or a relative one —
			// makes them reconstruct the path the caller just used.
			// --target is spelled out for the same reason it is resolved
			// rather than echoed verbatim: it defaults to the cwd, so a
			// reader who copies this line from a different directory
			// deploys into that other directory instead of the repo the
			// line was printed about.
			const adoptHint = `\nTo adopt it, run: node ${fileURLToPath(import.meta.url)} --target ${targetRoot} --deploy`;
			console.log(
				`The GitHub Issues backend (L3) is not adopted in this repo — no pfd-ops install/ files are deployed.${deployRefused ? "" : adoptHint}`,
			);
		} else {
			const issues = results.filter((r) => r.status !== "ok");
			if (issues.length === 0) {
				console.log(
					"pfd-ops install/ files are in sync with the deployed copies.",
				);
			} else {
				console.log("pfd-ops install/ files are out of sync:");
				for (const r of issues) {
					const label =
						r.status === "modified"
							? "different from bundled version"
							: r.status;
					console.log(`  ${label}: ${r.path}`);
				}
				printRenameCandidates(renameCandidates);
				if (!deployRefused) {
					console.log(
						"Run with --deploy to refresh. Files that carry no local edit are copied, and orphans that carry none are removed, without any further flag — add --overwrite-local-edits or --delete-edited-orphans only to discard the edits standing in the way.",
					);
				}
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
if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
) {
	main();
}
