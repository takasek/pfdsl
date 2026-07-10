#!/usr/bin/env node
// Runtime self-check for the pfd-ops "install/" tree (ADR-0028).
//
// This file ships inside the pfd-ops skill and is copied verbatim into the
// pfdsl plugin (plugin/pfdsl/skills/pfd-ops/scripts/check-install-sync.mjs),
// so it must not import anything outside itself — Node stdlib only.
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

function sha256(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function relPathParts(rel) {
	return rel.split("/");
}

// Records which install/ files this tool last deployed to a target, plus
// each file's canonical hash at that time, so a later run can tell "canonical
// dropped this file" (check: report orphaned; deploy: safe to remove) apart
// from "a file that merely happens to live at this path but was never
// deployed by this tool" (nothing to report or touch).
const MANIFEST_RELATIVE_PATH = ".claude/pfd-ops-install-manifest.json";

function readManifest(targetRoot) {
	const manifestPath = join(targetRoot, ...MANIFEST_RELATIVE_PATH.split("/"));
	if (!existsSync(manifestPath)) return [];
	try {
		const data = JSON.parse(readFileSync(manifestPath, "utf-8"));
		return Array.isArray(data.files) ? data.files : [];
	} catch {
		return [];
	}
}

function writeManifest(targetRoot, entries) {
	const manifestPath = join(targetRoot, ...MANIFEST_RELATIVE_PATH.split("/"));
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
		const canonicalPath = join(installDir, ...relPathParts(rel));
		const targetPath = join(targetRoot, ...relPathParts(rel));
		if (!existsSync(targetPath)) {
			return { path: rel, status: "missing" };
		}
		const status = sha256(canonicalPath) === sha256(targetPath) ? "ok" : "modified";
		return { path: rel, status };
	});

	const currentSet = new Set(files);
	const orphaned = readManifest(targetRoot)
		.filter((entry) => !currentSet.has(entry.path))
		.filter((entry) => existsSync(join(targetRoot, ...relPathParts(entry.path))))
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
		const canonicalPath = join(installDir, ...relPathParts(rel));
		const targetPath = join(targetRoot, ...relPathParts(rel));
		if (existsSync(targetPath) && !force) {
			const same = sha256(canonicalPath) === sha256(targetPath);
			if (!same) {
				skipped.push(rel);
				continue;
			}
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
		const targetPath = join(targetRoot, ...relPathParts(entry.path));
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
		...files.map((rel) => ({ path: rel, hash: sha256(join(installDir, ...relPathParts(rel))) })),
		...retainedOrphanEntries,
	]);

	return { copied, skipped, removed, orphanSkipped };
}

const UPSTREAM_PLUGIN_JSON_URL = "https://raw.githubusercontent.com/takasek/pfdsl/main/plugin/pfdsl/.claude-plugin/plugin.json";

/**
 * Best-effort version-skew warning: compares the locally installed plugin
 * version (read from `<skillRoot>/../../.claude-plugin/plugin.json`, which
 * only exists when running from an installed plugin) against upstream's
 * plugin.json on GitHub main. Silent (returns null) whenever the local
 * manifest is absent (repo-local run) or the fetch/parse fails for any
 * reason — this check must never break the caller.
 * @param {string} skillRoot
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string|null>}
 */
export async function checkUpstreamVersion(skillRoot, fetchImpl = fetch) {
	const localManifestPath = resolve(skillRoot, "../../.claude-plugin/plugin.json");
	if (!existsSync(localManifestPath)) return null;
	try {
		const localVersion = JSON.parse(readFileSync(localManifestPath, "utf-8")).version;
		const res = await fetchImpl(UPSTREAM_PLUGIN_JSON_URL, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return null;
		const remote = await res.json();
		if (!remote.version || remote.version === localVersion) return null;
		return `Warning: installed pfdsl plugin version (${localVersion}) differs from upstream (${remote.version}). Consider updating the plugin.`;
	} catch {
		return null;
	}
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
		if (copied.length > 0) {
			console.log("Copied:");
			for (const f of copied) console.log(`  ${f}`);
		}
		if (skipped.length > 0) {
			console.log("Skipped (locally modified; re-run with --force to overwrite):");
			for (const f of skipped) console.log(`  ${f}`);
			exitCode = 1;
		}
		if (removed.length > 0) {
			console.log("Removed (no longer part of canonical install/):");
			for (const f of removed) console.log(`  ${f}`);
		}
		if (orphanSkipped.length > 0) {
			console.log("Orphaned but locally modified; re-run with --force to remove:");
			for (const f of orphanSkipped) console.log(`  ${f}`);
			exitCode = 1;
		}
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
