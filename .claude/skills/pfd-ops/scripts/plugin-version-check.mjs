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
