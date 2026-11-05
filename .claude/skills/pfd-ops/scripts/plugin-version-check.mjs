#!/usr/bin/env node
// DO NOT EDIT. Authoritative source: scripts/harness-template/skills/pfd-ops/scripts/plugin-version-check.mjs.
// Local plugin identity and bundle-manifest readers for migration checks and
// environment reports. This bundled module uses Node stdlib only.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
function parseBundleManifestEntries(text) {
	const normalized = text.replaceAll("\r\n", "\n");
	if (!normalized.endsWith("\n")) return null;
	const entries = [];
	const seen = new Set();
	// A block holding a stray newline fails the match: `.` and the unflagged
	// `^`/`$` do not cross line boundaries.
	for (const block of normalized.slice(0, -1).split("\n\n")) {
		const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(block);
		if (match === null) return null;
		const [, hex, path] = match;
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
	try {
		return computeManifestAggregateHash(
			readFileSync(
				resolve(pluginRoot, ".claude-plugin/bundle-manifest.sha256"),
				"utf-8",
			),
		);
	} catch {
		return null;
	}
}

/**
 * Identify the plugin this script is running from: the version from whichever
 * plugin manifest the root carries, and the bundle aggregate hash only where a
 * bundle manifest exists. Only the Claude Code plugin has one; the Codex plugin
 * (`.codex-plugin/plugin.json`) is identified by its version alone, so a hash
 * is never invented for it. Returns null when no manifest names a version —
 * the repo-local run, where nothing says which release is executing.
 * @param {string} pluginRoot
 * @returns {{version: string, bundleHash: string | null} | null}
 */
export function readPluginIdentity(pluginRoot) {
	for (const manifestPath of [
		".claude-plugin/plugin.json",
		".codex-plugin/plugin.json",
	]) {
		const version = readJsonOrNull(resolve(pluginRoot, manifestPath))?.version;
		if (typeof version === "string" && version.trim().length > 0) {
			return { version, bundleHash: readLocalBundleAggregateHash(pluginRoot) };
		}
	}
	return null;
}
