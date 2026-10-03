#!/usr/bin/env node
// DO NOT EDIT. Authoritative source: scripts/harness-template/skills/pfd-ops/scripts/collect-report-environment.mjs.
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
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { readManifest } from "./check-install-sync.mjs";
import {
	readJsonOrNull,
	readLocalBundleAggregateHash,
} from "./plugin-version-check.mjs";

// A manifest that parses can still hold something unusable in an identifier's
// place — an empty string, whitespace, a number, an array. Those are collection
// failures, not values: reporting them would put a bare `42` where the reader
// expects a version.
/** @param {unknown} value */
function asIdentifier(value) {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
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

// check-install-sync.mjs has an ascent of its own, but it falls back to the
// directory it started from when no marker turns up. That is right for a
// --target that is assumed to be inside a repo, and wrong here: this collector
// needs "no checkout above the skill root" to stay distinguishable, since that
// is what makes the installation shape unknown.
/** @param {string} from */
function findRepoRootOrNull(from) {
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

const ABSENT = Symbol("absent");
const UNREADABLE = Symbol("unreadable");

// readJsonOrNull folds "no such file" and "not valid JSON" into one null, which
// is exactly the distinction this collector has to keep. A file that parses to
// something other than an object cannot be a package.json either.
/** @param {string} path */
function readJsonObject(path) {
	if (!existsSync(path)) return ABSENT;
	try {
		const value = JSON.parse(readFileSync(path, "utf-8"));
		const isObject =
			typeof value === "object" && value !== null && !Array.isArray(value);
		return isObject ? value : UNREADABLE;
	} catch {
		return UNREADABLE;
	}
}

/** @param {unknown} declared */
function isLocalSpec(declared) {
	return typeof declared === "string" && /^(file|link|portal):/.test(declared);
}

/**
 * @param {string} child
 * @param {string} parent
 */
function isWithin(child, parent) {
	const path = relative(parent, child);
	return (
		path === "" ||
		(path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
	);
}

// The directories from `start` up to `stop`, both included. A start outside
// `stop` is not walked at all: the ascent never leaves the project root.
/**
 * @param {string} start
 * @param {string} stop
 */
function directoriesUpTo(start, stop) {
	const directories = [];
	let current = isWithin(start, stop) ? start : stop;
	for (;;) {
		directories.push(current);
		if (current === stop) return directories;
		current = dirname(current);
	}
}

// The version of the @pfdsl/cli that a package.json in `declaringDirectory`
// resolves to. Node resolves a package through the nearest node_modules on the
// way up, and a workspace package's dependency is usually hoisted to the
// project root, so this ascends the same way — but only as far as the root.
/**
 * @param {string} declaringDirectory
 * @param {string} projectRoot
 */
function readInstalledCliVersion(declaringDirectory, projectRoot) {
	const directories = directoriesUpTo(declaringDirectory, projectRoot);
	for (const directory of directories) {
		const installed = readJsonObject(
			resolve(directory, "node_modules/@pfdsl/cli/package.json"),
		);
		if (installed === ABSENT) continue;
		if (installed === UNREADABLE) {
			return {
				version: null,
				reason:
					"package.json declares @pfdsl/cli but node_modules/@pfdsl/cli/package.json could not be parsed.",
			};
		}
		const version = asIdentifier(installed.version);
		return version === null
			? {
					version: null,
					reason:
						"package.json declares @pfdsl/cli but node_modules/@pfdsl/cli/package.json carries no usable version.",
				}
			: { version };
	}
	// Yarn Plug'n'Play keeps packages in zip archives and leaves no
	// node_modules, so an absent directory there is not "not installed".
	if (directories.some((d) => existsSync(resolve(d, ".pnp.cjs")))) {
		return {
			version: null,
			reason:
				"package.json declares @pfdsl/cli and the project uses Yarn Plug'n'Play, which has no node_modules to read the installed version from.",
		};
	}
	return null;
}

// The CLI a repository pins is not necessarily the one on PATH, so the report
// carries both. This reads the declaration and the installed package.json and
// never runs the repo-local binary. The reasons it gives state a category and
// never the declared value: they end up in a public issue, and a `file:` spec
// is a local absolute path. Returns null when no package.json between the
// working directory and the project root declares @pfdsl/cli: nothing was
// expected, so nothing is missing.
//
// In a monorepo the declaring package can sit below the project root, so the
// nearest package.json that declares it wins. A package.json that cannot be
// parsed stops the search: it may be the one that declares the CLI, and a
// farther declaration would then describe a different package.
/**
 * @param {string} workingDirectory
 * @param {string} projectRoot
 */
function readRepoCliVersion(workingDirectory, projectRoot) {
	for (const directory of directoriesUpTo(workingDirectory, projectRoot)) {
		const manifest = readJsonObject(resolve(directory, "package.json"));
		if (manifest === ABSENT) continue;
		if (manifest === UNREADABLE) {
			return {
				version: null,
				reason:
					"package.json could not be parsed, so whether it declares @pfdsl/cli is unknown.",
			};
		}
		// optionalDependencies install for the adopter like the other two, so they
		// count as a declaration. peerDependencies are left out: they ask whoever
		// consumes this package to provide @pfdsl/cli, so they do not install a CLI
		// for this project.
		const declared =
			manifest.dependencies?.["@pfdsl/cli"] ??
			manifest.devDependencies?.["@pfdsl/cli"] ??
			manifest.optionalDependencies?.["@pfdsl/cli"];
		if (declared === undefined) continue;
		return (
			readInstalledCliVersion(directory, projectRoot) ?? {
				version: null,
				reason: isLocalSpec(declared)
					? "package.json declares @pfdsl/cli as a local file or link spec, and node_modules/@pfdsl/cli is not installed."
					: "package.json declares @pfdsl/cli but node_modules/@pfdsl/cli is not installed.",
			}
		);
	}
	return null;
}

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
 *   findRepoRootOrNull?: (from: string) => string | null,
 *   cwd?: string,
 * }} [options]
 */
export function collectReportEnvironment(skillRoot, options = {}) {
	const resolveRepoRoot = options.findRepoRootOrNull ?? findRepoRootOrNull;
	const { installation, bundleRoot, repoRoot } = detectInstallation(
		skillRoot,
		resolveRepoRoot,
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
			readJsonOrNull(resolve(bundleRoot, ".claude-plugin/plugin.json"))
				?.version,
		);
		if (pluginVersion === null) {
			recordFailure(
				"pluginVersion",
				"The plugin manifest could not be parsed, or carried no usable version. Its absence is not reachable here: the installation shape is classified by that manifest existing.",
			);
		}
		bundleContentHash = readLocalBundleAggregateHash(bundleRoot);
		if (bundleContentHash === null) {
			recordFailure(
				"bundleContentHash",
				"The bundle manifest could not be read, or carried no usable per-file digests.",
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
	// A plugin installation has no checkout above its skill root, so the
	// working directory decides which project this is: the checkout that
	// contains it, or the directory itself outside any checkout. The bundle root
	// is never used as the project. A working directory inside it means the
	// collector was run from the plugin cache, where whatever package.json turns
	// up describes the bundle rather than an adopting project, so no project is
	// identified and that is reported instead.
	const workingDirectory = resolve(options.cwd ?? process.cwd());
	const isPluginBundle =
		installation === "claude-plugin" || installation === "codex-plugin";
	const repoCli =
		isPluginBundle && isWithin(workingDirectory, bundleRoot)
			? {
					version: null,
					reason:
						"The working directory is inside the plugin bundle, so no adopting project could be identified.",
				}
			: readRepoCliVersion(
					workingDirectory,
					repoRoot ?? resolveRepoRoot(workingDirectory) ?? workingDirectory,
				);
	if (repoCli !== null && repoCli.version === null) {
		recordFailure("repoCliVersion", repoCli.reason);
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
		...(repoCli === null ? {} : { repoCliVersion: repoCli.version }),
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
