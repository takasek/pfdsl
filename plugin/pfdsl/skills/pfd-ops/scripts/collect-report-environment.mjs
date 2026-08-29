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

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
 * @param {string} command
 * @param {string[]} args
 * @returns {string | null}
 */
function defaultRunCommand(command, args) {
	try {
		const result = spawnSync(command, args, { encoding: "utf-8" });
		if (result.status !== 0) return null;
		const out = result.stdout?.trim();
		return out ? out : null;
	} catch {
		return null;
	}
}

/** @param {string} from */
function findRepoRoot(from) {
	let current = resolve(from);
	for (;;) {
		if (existsSync(resolve(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/** @param {string} skillRoot */
function detectInstallation(skillRoot) {
	const bundleRoot = resolve(skillRoot, "../..");
	if (existsSync(resolve(bundleRoot, ".claude-plugin/plugin.json"))) {
		return { installation: "claude-plugin", bundleRoot, repoRoot: null };
	}
	if (existsSync(resolve(bundleRoot, ".codex-plugin/plugin.json"))) {
		return { installation: "codex-plugin", bundleRoot, repoRoot: null };
	}
	const repoRoot = findRepoRoot(skillRoot);
	if (repoRoot === null) {
		return { installation: "unknown", bundleRoot, repoRoot: null };
	}
	if (
		existsSync(resolve(repoRoot, "plugin/pfdsl/.claude-plugin/plugin.json")) &&
		existsSync(resolve(repoRoot, "scripts/lib/harness-inventory.mjs"))
	) {
		return { installation: "upstream-checkout", bundleRoot, repoRoot };
	}
	return { installation: "repo-local", bundleRoot, repoRoot };
}

/**
 * @param {string} skillRoot
 * @param {{ runCommand?: (command: string, args: string[]) => string | null }} [options]
 */
export function collectReportEnvironment(skillRoot, options = {}) {
	const { installation, bundleRoot, repoRoot } = detectInstallation(skillRoot);
	const unavailable = [];
	let pluginVersion = null;
	let bundleContentHash = null;
	let installProvenance = null;

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
	if (installation === "repo-local") {
		installProvenance = readJsonOrNull(
			resolve(repoRoot, "pfd-ops-install-manifest.json"),
		);
		unavailable.push({
			field: "pluginVersion",
			reason:
				"A repo-local install carries no plugin manifest; the install provenance identifies the bundle instead.",
		});
	}

	const runCommand = options.runCommand ?? defaultRunCommand;
	const cliVersion = runCommand("pfdsl", ["--version"]);
	if (cliVersion === null) {
		unavailable.push({
			field: "cliVersion",
			reason: "`pfdsl --version` did not run or returned no output.",
		});
	}
	const repoCommit =
		repoRoot === null
			? null
			: runCommand("git", ["-C", repoRoot, "rev-parse", "HEAD"]);

	return {
		installation,
		pluginVersion,
		bundleContentHash,
		cliVersion,
		repoCommit,
		installProvenance,
		unavailable,
	};
}
