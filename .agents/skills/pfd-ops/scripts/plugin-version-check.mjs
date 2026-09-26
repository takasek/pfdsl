#!/usr/bin/env node
// DO NOT EDIT. Authoritative source: .claude/skills/pfd-ops/scripts/plugin-version-check.mjs.
// Best-effort plugin version-skew check (ADR-0028). Decoupled from install/
// sync semantics so any pfd-ops-bundled skill's runtime self-check can call
// into it, not just check-install-sync.mjs.
//
// This file ships inside the pfd-ops skill and travels with the whole skill
// tree into the plugin bundle, so it must not import anything outside
// itself — Node stdlib only.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const UPSTREAM_RAW_BASE = "https://raw.githubusercontent.com/takasek/pfdsl/main/plugin/pfdsl/.claude-plugin";
const UPSTREAM_PLUGIN_JSON_URL = `${UPSTREAM_RAW_BASE}/plugin.json`;
const UPSTREAM_BUNDLE_MANIFEST_URL = `${UPSTREAM_RAW_BASE}/bundle-manifest.sha256`;

/** @param {string} path */
export function readJsonOrNull(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

/**
 * Parse a bundle-manifest.sha256 file's text (scripts/lib/bundle-manifest.mjs
 * is the writer) into its path-ordered entries. Returns null for anything the
 * writer would never produce: a 64-char lowercase-hex digest is expected to be
 * followed by exactly two spaces and a non-empty path, entries are separated
 * by exactly one blank line, no path repeats, and the text holds at least one
 * entry. CRLF line endings are accepted as LF: a plugin cache cloned with
 * core.autocrlf=true holds the file that way, and its digests still describe
 * the same bundle.
 * @param {string} text
 * @returns {{path: string, hex: string}[] | null}
 */
export function parseBundleManifestEntries(text) {
	if (text.length === 0) return null;
	const lines = text.split(/\r?\n/);
	if (lines[lines.length - 1] !== "") return null;
	lines.pop();
	if (lines.length === 0) return null;
	if (lines.length % 2 === 0) return null;
	const entries = [];
	const seen = new Set();
	for (let i = 0; i < lines.length; i++) {
		if (i % 2 === 1) {
			if (lines[i] !== "") return null;
			continue;
		}
		const line = lines[i];
		const hex = line.slice(0, 64);
		const separator = line.slice(64, 66);
		const path = line.slice(66);
		if (!/^[0-9a-f]{64}$/.test(hex)) return null;
		if (separator !== "  ") return null;
		if (path.length === 0) return null;
		if (seen.has(path)) return null;
		seen.add(path);
		entries.push({ path, hex });
	}
	return entries;
}

/**
 * The aggregate identifier readers compare, computed the same way
 * scripts/lib/bundle-manifest.mjs computed it directly before the manifest
 * became a per-file list (#1264): sha256 over `path` + "\0" + `hex` + "\n"
 * for every entry, in path order. Two texts with the same entries in any
 * order therefore produce the same aggregate.
 * @param {string} text
 * @returns {string | null}
 */
export function computeManifestAggregateHash(text) {
	const entries = parseBundleManifestEntries(text);
	if (entries === null) return null;
	const sorted = [...entries].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	const digest = createHash("sha256");
	for (const entry of sorted) {
		digest.update(entry.path);
		digest.update("\0");
		digest.update(entry.hex);
		digest.update("\n");
	}
	return digest.digest("hex");
}

/**
 * Read and aggregate the installed plugin's own bundle manifest. Returns null
 * when the file is absent (including every cache released before the
 * per-file format existed, whose `.claude-plugin/bundle-manifest.json` this
 * function does not look for) or malformed.
 * @param {string} pluginRoot
 * @returns {string | null}
 */
export function readLocalBundleAggregateHash(pluginRoot) {
	const path = resolve(pluginRoot, ".claude-plugin/bundle-manifest.sha256");
	if (!existsSync(path)) return null;
	try {
		return computeManifestAggregateHash(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 */
async function fetchJsonOrNull(fetchImpl, url) {
	const res = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
	if (!res.ok) return null;
	return await res.json();
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 */
async function fetchTextOrNull(fetchImpl, url) {
	const res = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
	if (!res.ok) return null;
	return await res.text();
}

/**
 * Best-effort skew warning for an installed plugin, on two axes.
 *
 * The version axis compares the locally installed plugin version (read from
 * `<skillRoot>/../../.claude-plugin/plugin.json`, which only exists when
 * running from an installed plugin) against upstream's plugin.json on main.
 *
 * The content axis only runs when the versions agree, and compares the
 * aggregate bundle identifier computed over `.claude-plugin/bundle-manifest.sha256`
 * (scripts/lib/bundle-manifest.mjs writes the per-file digests; this module
 * computes the aggregate). It exists because plugin.json's version is derived
 * from the CLI package version and so does not move between releases — two
 * bundles a hundred commits apart still report the same version (#971). Its
 * message states the difference and stops there: the marketplace source pins
 * a release tag rather than main, so a bundle change on main has no release
 * for the reader to update to.
 *
 * Silent (returns null) whenever the local plugin manifest is absent
 * (repo-local run), either side's bundle manifest is absent or malformed —
 * including every cache released before the per-file manifest existed, whose
 * only manifest is the old `bundle-manifest.json` this module does not read —
 * or the fetch/parse fails for any reason; this check must never break the
 * caller.
 * @param {string} skillRoot
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string|null>}
 */
export async function checkUpstreamVersion(skillRoot, fetchImpl = fetch) {
	const localManifest = readJsonOrNull(resolve(skillRoot, "../../.claude-plugin/plugin.json"));
	if (localManifest === null) return null;
	try {
		const localVersion = localManifest.version;
		const remote = await fetchJsonOrNull(fetchImpl, UPSTREAM_PLUGIN_JSON_URL);
		if (remote === null || !remote.version) return null;
		if (remote.version !== localVersion) {
			return `Warning: installed pfdsl plugin version (${localVersion}) differs from upstream (${remote.version}). Consider updating the plugin.`;
		}
		const localHash = readLocalBundleAggregateHash(resolve(skillRoot, "../.."));
		if (localHash === null) return null;
		const remoteText = await fetchTextOrNull(fetchImpl, UPSTREAM_BUNDLE_MANIFEST_URL);
		if (remoteText === null) return null;
		const remoteHash = computeManifestAggregateHash(remoteText);
		if (remoteHash === null || remoteHash === localHash) return null;
		return `Note: this installed pfdsl plugin bundle carries the same version (${localVersion}) as upstream main but different content — main holds bundle changes that no release includes yet.`;
	} catch {
		return null;
	}
}
