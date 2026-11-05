#!/usr/bin/env node
// Checks published versions of all packages against local package.json
// versions, plus the release gates that run nowhere else (distribution
// review currency, spec-history currency, and the migration guide's Unreleased
// section, which is shown here but only blocks a CLI/plugin release).
// Usage: node scripts/release-status.mjs
// Exit 1 if anything is left to do before the next publication — see
// needsAction in lib/release-status-check.mjs for what that covers.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git as rawGit } from "./lib/run-exec.mjs";

// These probes fail as a matter of course — an unreleased tag has no ref yet —
// so their stderr is captured rather than printed as if something broke.
const git = (args) => rawGit(args, { captureStderr: true });

import { runReleaseGates } from "./lib/release-gates.mjs";
import {
	compareVersions,
	formatPluginBundleStatus,
	formatResults,
	needsAction,
	readPluginBundleStatus,
} from "./lib/release-status-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function readLocalVersion(relativePath) {
	const pkg = JSON.parse(readFileSync(resolve(root, relativePath), "utf-8"));
	return pkg.version;
}

async function fetchNpmVersion(packageName) {
	const encoded = encodeURIComponent(packageName);
	const res = await fetch(`https://registry.npmjs.org/${encoded}/latest`);
	if (!res.ok) throw new Error(`npm registry responded ${res.status}`);
	const data = await res.json();
	return data.version;
}

function findBumpCommit(version, packageDir) {
	try {
		const pkgPath = `${packageDir}/package.json`;
		const hashes = git(["log", "--format=%H", "--", pkgPath])
			.trim()
			.split("\n")
			.filter(Boolean);
		for (const hash of hashes) {
			const content = git(["show", `${hash}:${pkgPath}`]);
			if (JSON.parse(content).version === version) return hash;
		}
		return null;
	} catch {
		return null;
	}
}

function fetchCommitsAhead(version, packageDir, tagPrefix = "v") {
	const tag = `${tagPrefix}${version}`;
	let baseRef;
	try {
		git(["rev-parse", tag]);
		baseRef = tag;
	} catch {
		baseRef = findBumpCommit(version, packageDir);
		if (!baseRef) return 0;
	}
	try {
		const out = git(["log", `${baseRef}..HEAD`, "--oneline", "--", packageDir]);
		return out.trim().split("\n").filter(Boolean).length;
	} catch {
		return 0;
	}
}

async function fetchVscodeMarketplaceVersion(publisher, extensionName) {
	const res = await fetch(
		"https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json;api-version=3.0-preview.1",
			},
			body: JSON.stringify({
				filters: [
					{
						criteria: [
							{ filterType: 7, value: `${publisher}.${extensionName}` },
						],
						pageNumber: 1,
						pageSize: 1,
					},
				],
				flags: 514,
			}),
		},
	);
	if (!res.ok) throw new Error(`VSCode Marketplace responded ${res.status}`);
	const data = await res.json();
	const ext = data.results?.[0]?.extensions?.[0];
	if (!ext)
		throw new Error(
			`${publisher}.${extensionName} not found in VSCode Marketplace`,
		);
	return ext.versions[0].version;
}

// Add new packages here to extend coverage.
const PACKAGES = [
	{
		name: "@pfdsl/cli",
		registry: "npm",
		localVersionPath: "packages/cli/package.json",
		packageDir: "packages/cli",
		tagPrefix: "v",
		fetchPublishedVersion: () => fetchNpmVersion("@pfdsl/cli"),
	},
	{
		name: "@pfdsl/core",
		registry: "npm",
		localVersionPath: "packages/core/package.json",
		packageDir: "packages/core",
		tagPrefix: "lib-v",
		fetchPublishedVersion: () => fetchNpmVersion("@pfdsl/core"),
	},
	{
		name: "@pfdsl/graphviz-exporter",
		registry: "npm",
		localVersionPath: "packages/graphviz-exporter/package.json",
		packageDir: "packages/graphviz-exporter",
		tagPrefix: "lib-v",
		fetchPublishedVersion: () => fetchNpmVersion("@pfdsl/graphviz-exporter"),
	},
	{
		name: "@pfdsl/preview-engine",
		registry: "npm",
		localVersionPath: "packages/preview-engine/package.json",
		packageDir: "packages/preview-engine",
		tagPrefix: "lib-v",
		fetchPublishedVersion: () => fetchNpmVersion("@pfdsl/preview-engine"),
	},
	{
		name: "takasek.pfdsl",
		registry: "vscode-marketplace",
		localVersionPath: "packages/vscode-extension/package.json",
		packageDir: "packages/vscode-extension",
		tagPrefix: "vscode-v",
		fetchPublishedVersion: () =>
			fetchVscodeMarketplaceVersion("takasek", "pfdsl"),
	},
];

const results = await Promise.all(
	PACKAGES.map(async (pkg) => {
		const localVersion = readLocalVersion(pkg.localVersionPath);
		let publishedVersion;
		let status;
		let commitsAhead = 0;
		try {
			publishedVersion = await pkg.fetchPublishedVersion();
			status = compareVersions(localVersion, publishedVersion);
			if (status === "equal") {
				commitsAhead = fetchCommitsAhead(
					localVersion,
					pkg.packageDir,
					pkg.tagPrefix,
				);
			}
		} catch (e) {
			publishedVersion = `error: ${e.message}`;
			status = "error";
		}
		return {
			name: pkg.name,
			registry: pkg.registry,
			localVersion,
			publishedVersion,
			status,
			commitsAhead,
		};
	}),
);

// CLI and plugin releases share v* tags, but their delivered contents differ.
function findLatestCliTag() {
	try {
		// 'v[0-9]*' (not 'v*') so this matches CLI tags like v0.0.17 without
		// also matching lib-v* / vscode-v* (both start with 'v' after the
		// prefix, and glob 'v*' would match "vscode-v0.0.17" too).
		return git([
			"describe",
			"--tags",
			"--match",
			"v[0-9]*",
			"--abbrev=0",
		]).trim();
	} catch {
		return null;
	}
}

const pluginBundleTag = findLatestCliTag();
const pluginBundle = readPluginBundleStatus(git, pluginBundleTag);

const gates = runReleaseGates(root, { mode: "status" });
for (const gate of gates) {
	for (const warning of gate.warnings ?? []) console.warn(warning);
}

console.log("release-status:");
console.log(formatResults(results));
console.log(formatPluginBundleStatus(pluginBundle, pluginBundleTag));
for (const gate of gates) console.log(gate.lines.join("\n"));

const pending = needsAction({
	results,
	pluginChangedFiles: pluginBundle.changedFiles,
	gates,
});
if (pending) process.exit(1);
