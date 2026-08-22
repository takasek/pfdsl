#!/usr/bin/env node
// Best-effort plugin version-skew check (ADR-0028). Decoupled from install/
// sync semantics so any pfd-ops-bundled skill's runtime self-check can call
// into it, not just check-install-sync.mjs.
//
// This file ships inside the pfd-ops skill and travels with the whole skill
// tree into the plugin bundle, so it must not import anything outside
// itself — Node stdlib only.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const UPSTREAM_RAW_BASE = "https://raw.githubusercontent.com/takasek/pfdsl/main/plugin/pfdsl/.claude-plugin";
const UPSTREAM_PLUGIN_JSON_URL = `${UPSTREAM_RAW_BASE}/plugin.json`;
const UPSTREAM_BUNDLE_MANIFEST_URL = `${UPSTREAM_RAW_BASE}/bundle-manifest.json`;

/** @param {string} path */
function readJsonOrNull(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
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
 * Best-effort skew warning for an installed plugin, on two axes.
 *
 * The version axis compares the locally installed plugin version (read from
 * `<skillRoot>/../../.claude-plugin/plugin.json`, which only exists when
 * running from an installed plugin) against upstream's plugin.json on main.
 *
 * The content axis only runs when the versions agree, and compares the bundle
 * content identifier recorded by scripts/lib/bundle-manifest.mjs. It exists
 * because plugin.json's version is derived from the CLI package version and so
 * does not move between releases — two bundles a hundred commits apart still
 * report the same version (#971). Its message states the difference and stops
 * there: the marketplace source pins a release tag rather than main, so a
 * bundle change on main has no release for the reader to update to.
 *
 * Silent (returns null) whenever the local plugin manifest is absent
 * (repo-local run), either side's bundle manifest is absent or malformed (every
 * cache released before it existed is in this state), or the fetch/parse fails
 * for any reason — this check must never break the caller.
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
		const localHash = readJsonOrNull(
			resolve(skillRoot, "../../.claude-plugin/bundle-manifest.json"),
		)?.contentHash;
		if (!localHash) return null;
		const remoteBundle = await fetchJsonOrNull(fetchImpl, UPSTREAM_BUNDLE_MANIFEST_URL);
		if (!remoteBundle?.contentHash || remoteBundle.contentHash === localHash) return null;
		return `Note: this installed pfdsl plugin bundle carries the same version (${localVersion}) as upstream main but different content — main holds bundle changes that no release includes yet.`;
	} catch {
		return null;
	}
}
