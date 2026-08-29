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

/** @param {string} skillRoot */
function detectInstallation(skillRoot) {
	const bundleRoot = resolve(skillRoot, "../..");
	if (existsSync(resolve(bundleRoot, ".claude-plugin/plugin.json"))) {
		return { installation: "claude-plugin", bundleRoot };
	}
	if (existsSync(resolve(bundleRoot, ".codex-plugin/plugin.json"))) {
		return { installation: "codex-plugin", bundleRoot };
	}
	return { installation: "unknown", bundleRoot };
}

/**
 * @param {string} skillRoot
 * @param {{ runCommand?: (command: string, args: string[]) => string | null }} [options]
 */
export function collectReportEnvironment(skillRoot, options = {}) {
	const { installation, bundleRoot } = detectInstallation(skillRoot);
	const unavailable = [];
	let pluginVersion = null;
	let bundleContentHash = null;

	if (installation === "claude-plugin") {
		pluginVersion =
			readJsonOrNull(resolve(bundleRoot, ".claude-plugin/plugin.json"))
				?.version ?? null;
		bundleContentHash =
			readJsonOrNull(resolve(bundleRoot, ".claude-plugin/bundle-manifest.json"))
				?.contentHash ?? null;
	}
	if (installation === "codex-plugin") {
		pluginVersion =
			readJsonOrNull(resolve(bundleRoot, ".codex-plugin/plugin.json"))
				?.version ?? null;
		unavailable.push({
			field: "bundleContentHash",
			reason:
				"Codex plugin bundles do not carry a bundle manifest, so the content hash cannot be read.",
		});
	}

	return {
		installation,
		pluginVersion,
		bundleContentHash,
		cliVersion: null,
		repoCommit: null,
		installProvenance: null,
		unavailable,
	};
}
