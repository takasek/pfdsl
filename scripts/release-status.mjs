#!/usr/bin/env node
// Checks published versions of all packages against local package.json versions.
// Usage: node scripts/release-status.mjs
// Exit 1 if any package is behind or has a fetch error.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
	compareVersions,
	formatResults,
	formatSkillBundleStatus,
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
		const hashes = execSync(`git log --format="%H" -- ${pkgPath}`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		})
			.trim()
			.split("\n")
			.filter(Boolean);
		for (const hash of hashes) {
			const content = execSync(`git show ${hash}:${pkgPath}`, {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});
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
		execSync(`git rev-parse ${tag}`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		baseRef = tag;
	} catch {
		baseRef = findBumpCommit(version, packageDir);
		if (!baseRef) return 0;
	}
	try {
		const out = execSync(`git log ${baseRef}..HEAD --oneline -- ${packageDir}`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
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
				commitsAhead = fetchCommitsAhead(localVersion, pkg.packageDir, pkg.tagPrefix);
			}
		} catch (e) {
			publishedVersion = `error: ${e.message}`;
			status = "error";
		}
		return { name: pkg.name, registry: pkg.registry, localVersion, publishedVersion, status, commitsAhead };
	}),
);

// .claude/skills and .claude/commands are bundled into @pfdsl/cli's dist at
// build time (tsup.config.ts onSuccess) and only reach adopting repos via a
// CLI release — editing them doesn't touch packages/cli/package.json, so the
// per-package commitsAhead check above misses this drift entirely.
function findLatestCliTag() {
	try {
		// 'v[0-9]*' (not 'v*') so this matches CLI tags like v0.0.17 without
		// also matching lib-v* / vscode-v* (both start with 'v' after the
		// prefix, and glob 'v*' would match "vscode-v0.0.17" too).
		return execSync("git describe --tags --match 'v[0-9]*' --abbrev=0", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

// Keep in sync with tsup.config.ts's onSuccess allowlist — .claude/skills/
// also holds skills that aren't bundled into the CLI (spec-stress-test,
// vscode-ext-debug), which would be false positives here.
const BUNDLED_SKILL_DIRS = ["pfd-ops", "pfd-retro", "pfd-ecosystem", "pfdsl"].map(
	(name) => `.claude/skills/${name}`,
);

function countSkillBundleCommits(sinceTag) {
	if (!sinceTag) return 0;
	try {
		const paths = [...BUNDLED_SKILL_DIRS, ".claude/commands"].join(" ");
		const out = execSync(`git log ${sinceTag}..HEAD --oneline -- ${paths}`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return out.trim().split("\n").filter(Boolean).length;
	} catch (e) {
		console.warn(`warn: could not count skill bundle commits since ${sinceTag}: ${e.message}`);
		return 0;
	}
}

const skillBundleTag = findLatestCliTag();
const skillBundleCommits = countSkillBundleCommits(skillBundleTag);

console.log("release-status:");
console.log(formatResults(results));
console.log(formatSkillBundleStatus(skillBundleCommits, skillBundleTag));

const needsAction =
	results.some(
		(r) => r.status === "local-ahead" || r.status === "error" || r.commitsAhead > 0,
	) || skillBundleCommits > 0;
if (needsAction) process.exit(1);
