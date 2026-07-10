#!/usr/bin/env node
// Runtime self-check for the pfd-ops "install/" tree (ADR-0028).
//
// This file ships inside the pfd-ops skill and is copied verbatim into the
// pfdsl plugin (plugin/pfdsl/skills/pfd-ops/scripts/check-install-sync.mjs),
// so it must not import anything outside itself — Node stdlib only.
//
// Usage: node check-install-sync.mjs [--target <dir>] [--deploy] [--force] [--upstream]

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
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

/**
 * Compare canonical install/ files against their deployed copies at
 * targetRoot. Returns per-file status ("ok" | "modified" | "missing") plus
 * an overall `adopted` flag (true iff at least one file is deployed).
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @returns {{ results: Array<{path: string, status: "ok"|"modified"|"missing"}>, adopted: boolean }}
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
	const adopted = results.some((r) => r.status !== "missing");
	return { results, adopted };
}

/**
 * Copy canonical install/ files to targetRoot, creating directories as
 * needed. A target file whose hash differs from canonical is treated as a
 * local edit and skipped unless force is true (a local edit would otherwise
 * be silently destroyed).
 * @param {string} skillRoot
 * @param {string} targetRoot
 * @param {{ force?: boolean }} [options]
 * @returns {{ copied: string[], skipped: string[] }}
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
	return { copied, skipped };
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
