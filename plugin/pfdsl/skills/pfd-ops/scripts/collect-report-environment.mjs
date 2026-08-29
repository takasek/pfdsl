#!/usr/bin/env node
// Collects the environment block of an upstream report (pfd-upstream-report).
//
// This file ships inside the pfd-ops skill and travels with the whole skill
// tree into every plugin bundle, so it must not import anything outside that
// tree — Node stdlib and its own siblings only.
//
// Unlike plugin-version-check.mjs, which returns null and stays silent when a
// manifest is missing, this reports what it could not obtain. A reader of the
// issue has to be able to tell "not available in this installation shape"
// from "collection failed".

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readManifest } from "./check-install-sync.mjs";

// A manifest that parses can still hold something unusable in an identifier's
// place — an empty string, whitespace, a number, an array. Those are collection
// failures, not values: reporting them would put a bare `42` where the reader
// expects a version.
/** @param {unknown} value */
function asIdentifier(value) {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

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

// Identifiers a given installation shape cannot carry at all. The distinction
// the reader of the issue needs is "not available in this shape" versus
// "collection failed", so every shape declares its own reason rather than
// letting the field drop out of the report silently.
const NOT_A_CHECKOUT =
	"A plugin installation is not a git checkout, so there is no commit to report.";
const PROVENANCE_IS_REPO_LOCAL_ONLY =
	"Install provenance is written only by a repo-local install.";

const MISSING_IDENTIFIERS = Object.freeze({
	"claude-plugin": Object.freeze({
		repoCommit: NOT_A_CHECKOUT,
		installProvenance: PROVENANCE_IS_REPO_LOCAL_ONLY,
	}),
	"codex-plugin": Object.freeze({
		bundleContentHash:
			"Codex plugin bundles do not carry a bundle manifest, so the content hash cannot be read.",
		repoCommit: NOT_A_CHECKOUT,
		installProvenance: PROVENANCE_IS_REPO_LOCAL_ONLY,
	}),
	"repo-local": Object.freeze({
		pluginVersion:
			"A repo-local install carries no plugin manifest; the install provenance identifies the bundle instead.",
		bundleContentHash:
			"A repo-local install carries no bundle manifest; the install provenance identifies the bundle instead.",
	}),
	"upstream-checkout": Object.freeze({
		pluginVersion:
			"The upstream checkout is the distribution source itself; the reported commit identifies it instead.",
		bundleContentHash:
			"The upstream checkout is the distribution source itself; the reported commit identifies it instead.",
		installProvenance: PROVENANCE_IS_REPO_LOCAL_ONLY,
	}),
	unknown: Object.freeze({
		pluginVersion:
			"The installation shape could not be determined, so no plugin manifest was read.",
		bundleContentHash:
			"The installation shape could not be determined, so no bundle manifest was read.",
		repoCommit:
			"No git checkout was found above the skill root, so there is no commit to report.",
		installProvenance: PROVENANCE_IS_REPO_LOCAL_ONLY,
	}),
});

/**
 * @param {string} skillRoot
 * @param {(from: string) => string | null} resolveRepoRoot
 */
function detectInstallation(skillRoot, resolveRepoRoot) {
	const bundleRoot = resolve(skillRoot, "../..");
	if (existsSync(resolve(bundleRoot, ".claude-plugin/plugin.json"))) {
		return { installation: "claude-plugin", bundleRoot, repoRoot: null };
	}
	if (existsSync(resolve(bundleRoot, ".codex-plugin/plugin.json"))) {
		return { installation: "codex-plugin", bundleRoot, repoRoot: null };
	}
	const repoRoot = resolveRepoRoot(skillRoot);
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
 * @param {{
 *   runCommand?: (command: string, args: string[]) => string | null,
 *   findRepoRoot?: (from: string) => string | null,
 * }} [options]
 */
export function collectReportEnvironment(skillRoot, options = {}) {
	const { installation, bundleRoot, repoRoot } = detectInstallation(
		skillRoot,
		options.findRepoRoot ?? findRepoRoot,
	);
	const unavailable = [];
	const missing = MISSING_IDENTIFIERS[installation] ?? {};

	// Records a field this installation shape was expected to carry but could
	// not be read. Shapes that never carry the field declare their own reason
	// through MISSING_IDENTIFIERS, so those are left to the loop below —
	// otherwise the same field would be reported twice with conflicting
	// explanations.
	function recordFailure(field, reason) {
		if (field in missing) return;
		unavailable.push({ field, reason });
	}

	let pluginVersion = null;
	let bundleContentHash = null;
	let installProvenance = null;

	if (installation === "claude-plugin") {
		pluginVersion = asIdentifier(
			readJsonOrNull(resolve(bundleRoot, ".claude-plugin/plugin.json"))?.version,
		);
		if (pluginVersion === null) {
			recordFailure(
				"pluginVersion",
				"The plugin manifest could not be parsed, or carried no usable version. Its absence is not reachable here: the installation shape is classified by that manifest existing.",
			);
		}
		bundleContentHash = asIdentifier(
			readJsonOrNull(resolve(bundleRoot, ".claude-plugin/bundle-manifest.json"))
				?.contentHash,
		);
		if (bundleContentHash === null) {
			recordFailure(
				"bundleContentHash",
				"The bundle manifest could not be read, or carried no usable content hash.",
			);
		}
	}
	if (installation === "codex-plugin") {
		pluginVersion = asIdentifier(
			readJsonOrNull(resolve(bundleRoot, ".codex-plugin/plugin.json"))?.version,
		);
		if (pluginVersion === null) {
			recordFailure(
				"pluginVersion",
				"The plugin manifest could not be parsed, or carried no usable version. Its absence is not reachable here: the installation shape is classified by that manifest existing.",
			);
		}
	}
	if (installation === "repo-local") {
		// The manifest's path and its per-entry schema both live in
		// check-install-sync.mjs, which writes the file. Reading it through that
		// module keeps this collector from carrying a second copy of either —
		// a copy that would drift into reporting "no provenance" for installs
		// that have one.
		const entries = readManifest(repoRoot);
		installProvenance = entries.length > 0 ? entries : null;
		if (installProvenance === null) {
			recordFailure(
				"installProvenance",
				"The install provenance file is absent, could not be read, or held no entry the installer recognises.",
			);
		}
	}
	for (const [field, reason] of Object.entries(missing)) {
		unavailable.push({ field, reason });
	}

	const runCommand = options.runCommand ?? defaultRunCommand;
	const cliVersion = runCommand("pfdsl", ["--version"]);
	if (cliVersion === null) {
		recordFailure(
			"cliVersion",
			"`pfdsl --version` did not run, or returned no output.",
		);
	}
	const repoCommit =
		repoRoot === null
			? null
			: runCommand("git", ["-C", repoRoot, "rev-parse", "HEAD"]);
	if (repoRoot !== null && repoCommit === null) {
		recordFailure(
			"repoCommit",
			"`git rev-parse HEAD` did not run, or returned no output.",
		);
	}

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

// Run as a command, this prints the report's environment block as JSON. The
// skill that files the report invokes it this way, so it resolves its own
// skill root rather than asking the caller for one.
//
// The entry path is compared through realpath: Node resolves symlinks before
// setting `import.meta.url`, so a bundle reached through a linked skill tree
// would otherwise compare a link against its own target and print nothing.
const selfPath = fileURLToPath(import.meta.url);

/** @param {string} entry */
function isDirectInvocation(entry) {
	try {
		return realpathSync(entry) === realpathSync(selfPath);
	} catch {
		return resolve(entry) === selfPath;
	}
}

if (process.argv[1] && isDirectInvocation(process.argv[1])) {
	const skillRoot = resolve(dirname(selfPath), "..");
	process.stdout.write(
		`${JSON.stringify(collectReportEnvironment(skillRoot), null, 2)}\n`,
	);
}
