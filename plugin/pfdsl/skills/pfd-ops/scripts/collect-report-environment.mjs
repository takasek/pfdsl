#!/usr/bin/env node
// Collects the environment block of an upstream report (pfd-upstream-report).
//
// This file ships inside the pfd-ops skill and travels with the whole skill
// tree into every plugin bundle, so it must not import anything outside
// itself — Node stdlib only.
//
// Unlike plugin-version-check.mjs, which returns null and stays silent when a
// manifest is missing, this reports what it could not obtain. A reader of the
// issue has to be able to tell "not available in this installation shape"
// from "collection failed".

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
 * @param {string} skillRoot
 * @param {{ runCommand?: (command: string, args: string[]) => string | null }} [options]
 */
export function collectReportEnvironment(skillRoot, options = {}) {
	const bundleRoot = resolve(skillRoot, "../..");
	const unavailable = [];
	const claudeManifest = readJsonOrNull(
		resolve(bundleRoot, ".claude-plugin/plugin.json"),
	);
	const bundleManifest = readJsonOrNull(
		resolve(bundleRoot, ".claude-plugin/bundle-manifest.json"),
	);
	return {
		installation: "claude-plugin",
		pluginVersion: claudeManifest?.version ?? null,
		bundleContentHash: bundleManifest?.contentHash ?? null,
		cliVersion: null,
		repoCommit: null,
		installProvenance: null,
		unavailable,
	};
}
